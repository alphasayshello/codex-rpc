import { drainHookEvents } from "./hook.js";
import { selectedState } from "./selection.js";
import { watchDirectory } from "./directory-watch.js";
import fs from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DiscordIPC, buildActivity } from "./ipc.js";
import {
  config,
  readJSON,
  writeJSON,
  file,
  home,
  alive,
  isMain,
} from "./store.js";
import { LogWatcher } from "./log-watcher.js";
import { pollChatGPT } from "./chatgpt-detector.js";
import { PresenceScheduler } from "./presence-scheduler.js";
export function rotateLog(message) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  try {
    if (fs.statSync(file("daemon.log")).size >= 5 * 1024 * 1024) {
      try {
        fs.unlinkSync(file("daemon.log.1"));
      } catch {}
      fs.renameSync(file("daemon.log"), file("daemon.log.1"));
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.appendFileSync(
    file("daemon.log"),
    `${new Date().toISOString()} ${message}\n`,
    { mode: 0o600 },
  );
}
export const backoff = (attempt, random = Math.random) =>
  Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.5);
// A chat-specific refresh supplements periodic history scans. Comparing only
// identity/status avoids repeated scans for unknown chats or changing tokens.
export function chatScanTrigger(previous = {}, state = {}) {
  if (!state.sessionId) return false;
  return previous.sessionId !== state.sessionId || previous.source !== state.source ||
    (["working", "thinking"].includes(previous.status) && state.status === "waiting");
}
export function startScanner(run = fork) {
  return run(fileURLToPath(new URL("./scanner.js", import.meta.url)), ["--live"],
    { stdio: "ignore", windowsHide: true });
}
export async function runDaemon() {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const prior = readJSON("daemon.json");
  if (alive(prior.pid)) throw Error("Daemon already running");
  let lock;
  try {
    lock = fs.openSync(file("daemon.lock"), "wx", 0o600);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let pid;
    try {
      pid = Number(fs.readFileSync(file("daemon.lock"), "utf8"));
    } catch {}
    if (alive(pid)) throw Error("Daemon lock is held");
    fs.unlinkSync(file("daemon.lock"));
    lock = fs.openSync(file("daemon.lock"), "wx", 0o600);
  }
  fs.writeFileSync(lock, String(process.pid));
  let client = null,
    connecting = false,
    attempt = 0,
    nextConnect = 0,
    lastScan = 0,
    lastDetect = 0,
    observedChat = {},
    pendingChatScan = false,
    scanner = null,
    stopped = false,
    lastClientId = "",
    tickBusy = false;
  const startedAt = Date.now();
  const presence = new PresenceScheduler();
  writeJSON("daemon.json", {
    pid: process.pid,
    startedAt,
    connected: false,
  });
  rotateLog("daemon started");
  const logWatcher = new LogWatcher();
  let lastWatch = 0;
  async function tick() {
    if (stopped || tickBusy) return;
    if (stopRequested()) {
      await stop();
      return;
    }
    tickBusy = true;
    try {
      drainHookEvents();
      const c = config(),
        now = Date.now();
      if (c.clientId !== lastClientId) {
        client?.close();
        client = null;
        lastClientId = c.clientId;
        nextConnect = 0;
        presence.reset();
      }
      if (!c.enabled) {
        if (client?.ready) await presence.clear((payload) => client.setActivity(payload)).catch(() => {});
        client?.close();
        client = null;
        writeJSON("daemon.json", {
          ...readJSON("daemon.json"),
          connected: false,
          heartbeat: now,
          paused: true,
        });
        return;
      }
      if (now - lastWatch >= c.timing.pollMs) {
        lastWatch = now;
        logWatcher.poll();
      }
      if (
        c.chatgpt.enabled &&
        now - lastDetect >= Math.max(c.timing.pollMs, 5000)
      ) {
        lastDetect = now;
        pollChatGPT().catch((e) => rotateLog(e.message));
      }
      const observed = readJSON("state.json");
      pendingChatScan ||= chatScanTrigger(observedChat, observed);
      observedChat = { sessionId: observed.sessionId, source: observed.source, status: observed.status };
      if (c.stats.enabled && !scanner &&
        (now - lastScan >= c.timing.scanMs || (pendingChatScan && now - lastScan >= 10000))) {
        pendingChatScan = false;
        lastScan = now;
        scanner = startScanner();
        scanner.on("error", (e) => rotateLog(e.message));
        scanner.on("exit", () => {
          scanner = null;
        });
      }
      if (!client?.ready && !connecting && now >= nextConnect && c.clientId) {
        connecting = true;
        client?.close();
        client = new DiscordIPC(c.clientId);
        client.on("fault", (e) => rotateLog(e.message));
        try {
          await client.connect();
          attempt = 0;
          presence.reset();
          rotateLog("Discord connected");
        } catch (e) {
          nextConnect = Date.now() + backoff(attempt++);
          rotateLog(e.message);
        } finally {
          connecting = false;
        }
      }
      if (stopped) return;
      const s = selectedState(c);
      if (now - (s.updatedAt || 0) > c.timing.idleMs) s.status = "idle";
      const payload = buildActivity(s, readJSON("aggregate.json"), c);
      presence.setPolicy({ intervalMs: Math.max(15000, c.timing.presenceMs) });
      presence.update(payload, JSON.stringify([s.source, s.sessionId, s.status, s.tool || null, payload?.assets?.large_image]));
      if (client?.ready) await presence.flush((activity) => client.setActivity(activity));
      if (stopped) return;
      writeJSON("daemon.json", {
        ...readJSON("daemon.json"),
        pid: process.pid,
        connected: !!client?.ready,
        heartbeat: now,
        paused: false,
        nextReconnect: nextConnect,
      });
    } catch (e) {
      rotateLog(e.message);
    } finally {
      tickBusy = false;
    }
  }
  const timer = setInterval(tick, 1000);
  function stopRequested() {
    const request = readJSON("control.json");
    return (
      request.action === "stop" &&
      request.pid === process.pid &&
      request.startedAt === startedAt
    );
  }
  const watcher = watchDirectory(home(), ["control.json", "state.json", "config.json", "aggregate.json", "sessions.json", "selection.json"], (name) => {
    if (name === "control.json" && stopRequested()) {
      stop().catch((e) => rotateLog(e.message));
      return;
    }
    if (["state.json", "config.json", "aggregate.json", "sessions.json", "selection.json"].includes(name)) tick();
  });
  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    watcher.close();
    scanner?.kill();
    if (client?.ready) await presence.clear((payload) => client.setActivity(payload)).catch(() => {});
    client?.close();
    writeJSON("daemon.json", {
      pid: null,
      connected: false,
      stoppedAt: Date.now(),
    });
    fs.closeSync(lock);
    try {
      fs.unlinkSync(file("daemon.lock"));
    } catch {}
    rotateLog("daemon stopped");
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await tick();
  return { stop };
}
if (isMain(import.meta.url))
  runDaemon().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });

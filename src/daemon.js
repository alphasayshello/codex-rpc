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
    lastSend = 0,
    lastScan = 0,
    lastDetect = 0,
    scanner = null,
    stopped = false,
    lastPayload = "",
    lastClientId = "",
    tickBusy = false;
  writeJSON("daemon.json", {
    pid: process.pid,
    startedAt: Date.now(),
    connected: false,
  });
  rotateLog("daemon started");
  const logWatcher = new LogWatcher();
  let lastWatch = 0;
  async function tick() {
    if (stopped || tickBusy) return;
    tickBusy = true;
    try {
      const c = config(),
        now = Date.now();
      if (c.clientId !== lastClientId) {
        client?.close();
        client = null;
        lastClientId = c.clientId;
        nextConnect = 0;
      }
      if (!c.enabled) {
        if (client?.ready) await client.setActivity(null).catch(() => {});
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
      if (c.stats.enabled && now - lastScan >= c.timing.scanMs && !scanner) {
        lastScan = now;
        scanner = fork(
          fileURLToPath(new URL("./scanner.js", import.meta.url)),
          ["--live"],
          { stdio: "ignore" },
        );
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
          lastPayload = "";
          rotateLog("Discord connected");
        } catch (e) {
          nextConnect = Date.now() + backoff(attempt++);
          rotateLog(e.message);
        } finally {
          connecting = false;
        }
      }
      if (stopped) return;
      const s = readJSON("state.json", { status: "idle" });
      if (now - (s.updatedAt || 0) > c.timing.idleMs) s.status = "idle";
      const payload = buildActivity(s, readJSON("aggregate.json"), c),
        encoded = JSON.stringify(payload);
      if (
        client?.ready &&
        encoded !== lastPayload &&
        now - lastSend >= Math.max(15000, c.timing.presenceMs)
      ) {
        lastSend = now;
        await client.setActivity(payload);
        lastPayload = encoded;
      }
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
  const watcher = fs.watch(home(), (_, name) => {
    if (["state.json", "config.json", "aggregate.json"].includes(name)) tick();
  });
  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    watcher.close();
    scanner?.kill();
    if (client?.ready) await client.setActivity(null).catch(() => {});
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

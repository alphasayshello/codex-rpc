import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyEvent } from "./hook.js";
import { config, readJSON, writeJSON } from "./store.js";
import { emptyStats, mergeStats } from "./scanner.js";
const exec = promisify(execFile);
export const backgroundExecOptions = (timeout) => ({ timeout, windowsHide: true });
export async function detectChatGPT({
  platform = process.platform,
  run = exec,
} = {}) {
  try {
    if (platform === "darwin") {
      const { stdout } = await run(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get {name, frontmost} of every application process whose name is "ChatGPT"',
        ],
        backgroundExecOptions(1500),
      );
      return {
        running: stdout.includes("ChatGPT"),
        foreground: /true/i.test(stdout),
        method: "macOS process/frontmost",
      };
    }
    if (platform === "win32") {
      const { stdout } = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id",
        ],
        backgroundExecOptions(2000),
      );
      return {
        running: !!stdout.trim(),
        foreground: null,
        method: "Windows process (foreground unavailable)",
      };
    }
    const { stdout } = await run("pgrep", ["-x", "ChatGPT"], backgroundExecOptions(1500));
    let foreground = null;
    try {
      const active = await run(
        "xdotool",
        ["getactivewindow", "getwindowclassname"],
        backgroundExecOptions(1000),
      );
      foreground = /chatgpt/i.test(active.stdout);
    } catch {}
    return {
      running: !!stdout.trim(),
      foreground,
      method: "Linux process / optional X11 window",
    };
  } catch (e) {
    return {
      running: false,
      foreground: false,
      method: "process",
      error: e.code === 1 ? undefined : e.message,
    };
  }
}
export function recordObservation(detection, now = Date.now()) {
  if (!config().enabled || !config().stats.enabled) return;
  const prior = readJSON("chatgpt-observation.json"),
    summary = readJSON("desktop-aggregate.json", { days: {} });
  const delta = emptyStats(),
    elapsed = (now - (prior.observedAt || now)) / 1000;
  if (detection.running && !prior.running) {
    delta.sessions = 1;
    delta.sourceSessions.chatgpt = 1;
  }
  // Only observed foreground intervals count; unknown foreground is not focus.
  if (
    detection.running &&
    detection.foreground === true &&
    prior.running &&
    prior.foreground === true &&
    elapsed > 0 &&
    elapsed <= 15
  ) {
    delta.activeSeconds = elapsed;
    delta.sourceHours.chatgpt = elapsed / 3600;
    delta.hours[new Date(now).getUTCHours()]++;
  }
  if (delta.sessions || delta.activeSeconds) {
    const day = new Date(now).toISOString().slice(0, 10);
    mergeStats((summary.days[day] ||= emptyStats()), delta);
    writeJSON("desktop-aggregate.json", summary);
  }
  writeJSON("chatgpt-observation.json", {
    running: detection.running,
    foreground: detection.foreground,
    observedAt: now,
  });
}
export async function pollChatGPT() {
  const detection = await detectChatGPT();
  recordObservation(detection);
  const old = readJSON("chatgpt-state.json");
  const type = !detection.running
    ? "app-closed"
    : detection.foreground === false
      ? "app-background"
      : "app-active";
  const desired = type === "app-active" ? "waiting" : "idle";
  if (
    old.status !== desired ||
    !old.updatedAt ||
    Date.now() - old.updatedAt > 60000
  )
    applyEvent({ type, source: "chatgpt" });
  return detection;
}

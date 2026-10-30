import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyEvent } from "./hook.js";
const exec = promisify(execFile);
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
        { timeout: 1500 },
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
        { timeout: 2000 },
      );
      return {
        running: !!stdout.trim(),
        foreground: null,
        method: "Windows process (foreground unavailable)",
      };
    }
    const { stdout } = await run("pgrep", ["-x", "ChatGPT"], { timeout: 1500 });
    let foreground = null;
    try {
      const active = await run(
        "xdotool",
        ["getactivewindow", "getwindowclassname"],
        { timeout: 1000 },
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
export async function pollChatGPT() {
  const detection = await detectChatGPT();
  const old = (await import("./store.js")).readJSON("chatgpt-state.json");
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

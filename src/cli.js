import fs from "node:fs";
import { selectedState } from "./selection.js";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildActivity } from "./presence.js";
import { animationStates, readJSON, writeJSON, config } from "./store.js";
import { scan } from "./scanner.js";
import { main as hook, applyEvent } from "./hook.js";
import { runDaemon } from "./daemon.js";
import { setup, startDaemon, stopDaemon, uninstall } from "./service.js";
import { renderStatus, renderChat, insights } from "./tui.js";
import { getChatStats } from "./chat.js";
import { doctor } from "./doctor.js";
import { serve } from "./server.js";
import { generateCards } from "./statcards.js";
import { completion, installCompletion } from "./completion.js";
export const help = `codex-rpc / a little presence.

Usage: codex-rpc <command>

  setup         Wire notify, enable detector, install service, start daemon
  status        Live state, current chat and lifetime totals (--watch)
  chat          Current-chat tokens, tools, cost, context (--json, --watch)
  usage         Heatmap, hourly histogram, tools, languages, API estimates
  insights      Five contextual lines about your week
  preview       Show Discord text/assets for core scenes (--all: all 19 animations)
  serve         Local dashboard + seven settings tabs (port 47474)
  statcards     Generate stats.svg, heatmap.svg, badges and Markdown
  doctor        Diagnose hooks, daemon, detector, IPC, stats, privacy
  pause/resume  Disable or enable presence and collection
  start/restart/stop  Manage the background daemon
  uninstall     Remove integration; retain local analytics/config
  completion install [bash|zsh|fish|powershell]
  scan          Refresh lifetime analytics
  hook          Accept JSON argument or stdin lifecycle events
  run -- ...    Wrap the Codex CLI for session start/end detection
  help/version

Setup flags: --no-service --no-start
Serve flags: --port <port>  Statcards: --output <directory>
Use CODEX_RPC_HOME / CODEX_HOME to isolate state and input logs.
`;
export async function main(args = process.argv.slice(2)) {
  const [cmd = "help", ...rest] = args;
  const option = (name, fallback) => {
    const i = rest.indexOf(name);
    if (i < 0) return fallback;
    if (!rest[i + 1]) throw Error(`${name} needs a value`);
    return rest[i + 1];
  };
  switch (cmd) {
    case "help":
    case "--help":
    case "-h":
      console.log(help);
      break;
    case "version":
    case "--version":
      console.log(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
      break;
    case "hook":
      await hook();
      break;
    case "daemon":
      await runDaemon();
      break;
    case "setup":
      console.log(
        JSON.stringify(
          await setup({
            noService: rest.includes("--no-service"),
            noStart: rest.includes("--no-start"),
          }),
          null,
          2,
        ),
      );
      if (!config().clientId)
        console.log(
          "Set your Discord Application ID in the dashboard Discord tab; host the pet GIFs or upload assets.",
        );
      break;
    case "start":
      console.log(await startDaemon());
      break;
    case "stop":
      console.log(await stopDaemon());
      break;
    case "restart":
      await stopDaemon();
      console.log(await startDaemon());
      break;
    case "uninstall":
      console.log(await uninstall());
      break;
    case "pause":
    case "resume":
      writeJSON("config.json", { ...config(), enabled: cmd === "resume" });
      console.log(cmd === "pause" ? "Paused." : "Resumed.");
      break;
    case "scan": {
      const a = await scan();
      console.log(
        `${a.totals.sessions} sessions · ${a.totals.tokens} tokens · ${a.filesScanned} changed / ${a.filesReused} cached files`,
      );
      break;
    }
    case "status":
    case "usage":
    case "chat": {
      const render = () => console.log(
        cmd === "chat"
          ? rest.includes("--json")
            ? JSON.stringify(getChatStats(selectedState()), null, 2)
            : renderChat()
          : renderStatus({ usage: cmd === "usage", currentChat: cmd === "status" }),
      );
      render();
      if (rest.includes("--watch")) {
        const timer = setInterval(() => {
          if (!rest.includes("--json")) process.stdout.write("\x1b[2J\x1b[H");
          render();
        }, 3000);
        for (const signal of ["SIGINT", "SIGTERM"])
          process.once(signal, () => clearInterval(timer));
      }
      break;
    }
    case "preview": {
      const state = readJSON("state.json"),
        aggregate = readJSON("aggregate.json"),
        settings = { ...config(), enabled: true };
      const previewScenes = rest.includes("--all") ? animationStates : ["writing", "patching", "thinking", "error", "done", "idle", "waiting"];
      for (const scene of previewScenes) {
        const status = scene.startsWith("idle") ? "idle" : scene === "thinking" ? "thinking" : ["error", "done", "waiting", "celebrating"].includes(scene) ? "waiting" : "working";
        const activity = buildActivity(
          { ...state, status, visualState: scene, waitingReason: scene === "error" ? "error" : ["done", "celebrating"].includes(scene) ? "done" : undefined, eventTime: Date.now() },
          aggregate,
          settings,
        );
        console.log(
          `\n${scene.toUpperCase()} · ${activity.type === 3 ? "Watching" : "Playing"}\n${activity.details}\n${activity.state}\n${activity.assets.large_image}`,
        );
      }
      break;
    }
    case "insights":
      console.log(insights());
      break;
    case "doctor":
      for (const row of await doctor())
        console.log(`${row.ok ? "✓" : "!"} ${row.name}: ${row.hint}`);
      break;
    case "serve": {
      const port = Number(option("--port", 47474));
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw Error("Invalid port");
      const server = await serve(port);
      console.log(
        `codex-rpc dashboard: http://localhost:${server.address().port}`,
      );
      for (const s of ["SIGINT", "SIGTERM"])
        process.once(s, () => server.closeDashboard());
      break;
    }
    case "statcards":
      console.log(generateCards(path.resolve(option("--output", "statcards"))));
      break;
    case "completion":
      console.log(
        rest[0] === "install"
          ? installCompletion(rest[1])
          : completion(rest[0] || "bash"),
      );
      break;
    case "run": {
      applyEvent({
        type: "session-start",
        sessionId: `wrapper-${process.pid}`,
        cwd: process.cwd(),
      });
      const child = spawn(
        process.env.CODEX_RPC_CODEX_BIN || "codex",
        rest[0] === "--" ? rest.slice(1) : rest,
        { stdio: "inherit", shell: false },
      );
      const forward = (s) => {
        try {
          child.kill(s);
        } catch {}
      };
      const sigint = () => forward("SIGINT"),
        sigterm = () => forward("SIGTERM");
      process.on("SIGINT", sigint);
      process.on("SIGTERM", sigterm);
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          process.exitCode = code ?? (signal ? 1 : 0);
          resolve();
        });
      }).finally(() => {
        process.removeListener("SIGINT", sigint);
        process.removeListener("SIGTERM", sigterm);
        applyEvent({ type: "session-end" });
      });
      break;
    }
    default:
      throw Error(`Unknown command: ${cmd}. Run codex-rpc help.`);
  }
}

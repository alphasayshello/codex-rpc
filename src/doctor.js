import fs from "node:fs";
import path from "node:path";
import { config, validateConfig, readJSON, alive, codexHome } from "./store.js";
import { DiscordIPC, existingSockets } from "./ipc.js";
import { detectChatGPT } from "./chatgpt-detector.js";
export async function doctor() {
  const c = config(),
    d = readJSON("daemon.json"),
    a = readJSON("aggregate.json");
  let hook = "";
  try {
    hook = fs.readFileSync(path.join(codexHome(), "config.toml"), "utf8");
  } catch {}
  const detector = c.chatgpt.enabled
    ? await detectChatGPT()
    : { error: "Detector disabled" };
  let discord = false,
    discordHint = "Open Discord Desktop and configure clientId";
  if (c.clientId) {
    const client = new DiscordIPC(c.clientId, {
      paths: existingSockets(),
      timeout: 500,
    });
    try {
      await client.connect();
      discord = true;
    } catch (e) {
      discordHint = e.message;
    } finally {
      client.close();
    }
  }
  let valid = true;
  try {
    validateConfig(c);
  } catch {
    valid = false;
  }
  return [
    [
      "Node 18+",
      Number(process.versions.node.split(".")[0]) >= 18,
      "Install Node 18+",
    ],
    [
      "Codex notify",
      hook.includes("# codex-rpc notify begin"),
      "Run codex-rpc setup; existing notifiers require manual chaining",
    ],
    [
      "ChatGPT detector",
      c.chatgpt.enabled && !detector.error,
      detector.error || "Enable chatgpt.enabled; app need not be running",
    ],
    ["Daemon", alive(d.pid), "Run codex-rpc start"],
    ["Discord IPC", discord, discordHint],
    [
      "Aggregate freshness",
      !!a.updatedAt && Date.now() - a.updatedAt < 300000,
      "Run codex-rpc scan",
    ],
    [
      "Privacy/config",
      valid && c.privacy === "private",
      'Set privacy: "private" to redact project and file names',
    ],
  ].map(([name, ok, hint]) => ({ name, ok, hint: ok ? "OK" : hint }));
}

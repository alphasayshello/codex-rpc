import { inspectLifecycleHooks } from "./hooks-config.js";
import { config, validateConfig, readJSON, alive } from "./store.js";
import { DiscordIPC, existingSockets } from "./ipc.js";
import { detectChatGPT } from "./chatgpt-detector.js";
export async function doctor() {
  const c = config(),
    d = readJSON("daemon.json"),
    a = readJSON("aggregate.json");
  const lifecycle = inspectLifecycleHooks();
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
  let valid = true,
    configHint = "";
  try {
    validateConfig(c);
  } catch (error) {
    valid = false;
    configHint = error.message;
  }
  return [
    [
      "Node 18+",
      Number(process.versions.node.split(".")[0]) >= 18,
      "Install Node 18+",
    ],
    [
      "Codex notify",
      lifecycle.legacyNotify.configured,
      lifecycle.legacyNotify.owned ? "Legacy codex-rpc notify registered (completion compatibility)" : lifecycle.legacyNotify.configured
        ? "Custom notify preserved; lifecycle hooks are configured separately" : "Run codex-rpc setup; existing notifiers remain untouched",
      true,
    ],
    [
      "Codex lifecycle hooks",
      lifecycle.configured && lifecycle.featuresEnabled !== false,
      lifecycle.errors[0] || (lifecycle.featuresEnabled === false ? "features.hooks=false was preserved. Enable hooks manually if desired, then review /hooks."
        : lifecycle.configured ? `${lifecycle.eventCount} configured; trust unknown. ${lifecycle.guidance}` : "Run codex-rpc setup to add lifecycle hooks, then review and trust them in /hooks."),
      true,
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
      valid,
      configHint,
    ],
  ].map(([name, ok, hint, keepHint]) => ({ name, ok, hint: ok && !keepHint ? "OK" : hint }));
}

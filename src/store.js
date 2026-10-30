import fs from "node:fs";
import { replaceFile } from "./atomic.js";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
export const home = () =>
  process.env.CODEX_RPC_HOME || path.join(os.homedir(), ".codex-rpc");
export const codexHome = () =>
  process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const file = (name) => path.join(home(), name);
export const defaults = {
  enabled: true,
  privacy: "private",
  clientId: "1565535814308470814",
  buttons: [],
  presence: { type: 3, showTask: true, stats: "telemetry", showChurn: true, timer: "operation" },
  assets: {
    working:
      "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-working.gif?v=motion-2",
    thinking:
      "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-thinking.gif?v=motion-2",
    waiting:
      "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-waiting.gif?v=motion-2",
    idle: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-idle.gif?v=motion-2",
    writing: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-writing.gif?v=motion-2",
    patching: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-patching.gif?v=motion-2",
    error: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-error.gif?v=motion-2",
    done: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-done.gif?v=motion-2",
    badge: "",
  },
  timing: { idleMs: 300000, pollMs: 2000, scanMs: 60000, presenceMs: 15000, successMs: 15000 },
  chatgpt: { enabled: true },
  stats: { enabled: true },
};
export function readJSON(name, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" || e instanceof SyntaxError)
      return structuredClone(fallback);
    throw e;
  }
}
export function writeJSON(name, value) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const target = file(name),
    temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    replaceFile(temp, target);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
  return value;
}
export function config() {
  const c = readJSON("config.json");
  return {
    ...defaults,
    ...c,
    assets: { ...defaults.assets, ...c.assets },
    presence: { ...defaults.presence, ...c.presence },
    timing: { ...defaults.timing, ...c.timing },
    chatgpt: { ...defaults.chatgpt, ...c.chatgpt },
    stats: { ...defaults.stats, ...c.stats },
  };
}
export function validateConfig(c) {
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw Error("Config must be an object");
  for (const k of Object.keys(c))
    if (!(k in defaults)) throw Error(`Unknown setting: ${k}`);
  const n = { ...config(), ...c };
  if (
    c.presence !== undefined &&
    (!c.presence || typeof c.presence !== "object" || Array.isArray(c.presence))
  )
    throw Error("Invalid presence settings");
  n.presence = { ...config().presence, ...n.presence };
  if (
    ![0, 3].includes(n.presence.type) ||
    !["telemetry", "chat", "cost", "tokens"].includes(n.presence.stats) ||
    !["operation", "session"].includes(n.presence.timer) ||
    typeof n.presence.showTask !== "boolean" ||
    typeof n.presence.showChurn !== "boolean"
  )
    throw Error("Invalid presence settings");
  if (!["private", "public"].includes(n.privacy))
    throw Error("privacy must be private or public");
  if (typeof n.enabled !== "boolean" || !/^\d{0,22}$/.test(n.clientId))
    throw Error("Invalid enabled/clientId");
  if (
    !Array.isArray(n.buttons) ||
    n.buttons.length > 2 ||
    n.buttons.some(
      (b) =>
        !b ||
        typeof b.label !== "string" ||
        !b.label.length ||
        b.label.length > 32 ||
        !/^https?:\/\//.test(b.url),
    )
  )
    throw Error("Use up to two HTTP(S) buttons");
  if (
    !n.assets ||
    typeof n.assets !== "object" ||
    Array.isArray(n.assets) ||
    !n.timing ||
    typeof n.timing !== "object" ||
    Array.isArray(n.timing)
  )
    throw Error("Assets and timing must be objects");
  n.assets = { ...config().assets, ...n.assets };
  n.timing = { ...config().timing, ...n.timing };
  for (const [k, v] of Object.entries(n.assets))
    if (
      !(k in defaults.assets) ||
      typeof v !== "string" ||
      (v && !/^https:\/\//.test(v) && !/^[\w-]+$/.test(v))
    )
      throw Error("Assets must be HTTPS URLs or Discord asset keys");
  for (const [k, v] of Object.entries(n.timing))
    if (
      !(k in defaults.timing) ||
      !Number.isFinite(v) ||
      v < 1000 ||
      v > 86400000
    )
      throw Error("Timing must be 1000..86400000 milliseconds");
  for (const k of ["chatgpt", "stats"])
    if (typeof n[k]?.enabled !== "boolean")
      throw Error(`${k}.enabled must be boolean`);
  return n;
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export function xml(s) {
  return String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
export function isMain(url) {
  return (
    process.argv[1] && url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

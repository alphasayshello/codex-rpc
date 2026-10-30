// Owned inline Codex lifecycle hooks. Installation never changes hook trust,
// feature flags, unrelated notifiers, or external hooks.json definitions.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { replaceFile } from "./atomic.js";
import { codexHome, home, file } from "./store.js";
export const lifecycleEvents = Object.freeze([
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PermissionRequest", "Stop", "Interrupt", "PreCompact", "PostCompact",
]);
const begin = "# codex-rpc lifecycle hooks begin", end = "# codex-rpc lifecycle hooks end";
const guidance = "Open /hooks in Codex to review and trust the codex-rpc hooks. Trust cannot be inferred from configuration; changed hooks require another review.";
const targetPath = () => path.join(codexHome(), "config.toml");
const read = (target) => { try { return fs.readFileSync(target, "utf8"); } catch (e) { if (e.code === "ENOENT") return ""; throw e; } };
// Mask strings/comments before recognizing structural lines. In particular,
// marker-looking text inside a user's multiline TOML string is never ours.
function linesOf(text) {
  let multiline = null, offset = 0;
  return text.split(/(?<=\n)/).map((line) => {
    const atStart = !multiline; let visible = "", quoted = null;
    for (let i = 0; i < line.length;) {
      if (multiline) {
        if (multiline === '"""' && line[i] === "\\") { i += 2; continue; }
        if (line.startsWith(multiline, i)) { i += 3; multiline = null; } else i++;
        continue;
      }
      if (quoted) {
        if (quoted === '"' && line[i] === "\\") { i += 2; continue; }
        if (line[i] === quoted) quoted = null;
        i++; continue;
      }
      if (line[i] === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { multiline = line.slice(i, i + 3); i += 3; continue; }
      if (["'", '"'].includes(line[i])) { quoted = line[i++]; continue; }
      visible += line[i++];
    }
    const row = { raw: line.replace(/\r?\n$/, ""), visible: visible.trim(), start: offset, stop: offset + line.length, atStart };
    offset += line.length; return row;
  });
}
function managed(text) {
  const rows = linesOf(text), markers = rows.filter((row) => row.atStart && [begin, end].includes(row.raw));
  if (!markers.length) return { clean: text, events: [], present: false };
  if (markers.length !== 2 || markers[0].raw !== begin || markers[1].raw !== end)
    throw Error("Incomplete or duplicate codex-rpc lifecycle markers; config.toml was preserved. Repair the owned marker block manually.");
  const first = markers[0], last = markers[1], events = [];
  const body = rows.filter((row) => row.start > first.start && row.start < last.start);
  let group = null, handler = false, fields = new Set();
  const finishHandler = () => {
    if (group && (!handler || !["type", "command", "command_windows", "timeout"].every((field) => fields.has(field))))
      throw Error("Incomplete owned lifecycle handler; config.toml was preserved.");
  };
  for (const row of body) {
    if (!row.visible) continue;
    const table = /^\[\[hooks\.([A-Za-z]+)(\.hooks)?\]\]$/.exec(row.visible);
    if (table && lifecycleEvents.includes(table[1])) {
      if (table[2]) { if (handler || group !== table[1]) throw Error("Invalid owned lifecycle hook group; config.toml was preserved."); handler = true; }
      else { finishHandler(); group = table[1]; handler = false; fields = new Set(); if (events.includes(group)) throw Error("Duplicate owned lifecycle event; config.toml was preserved."); events.push(group); }
      continue;
    }
    const assignment = /^(type|command|command_windows|timeout)\s*=/.exec(row.visible);
    if (!assignment || !handler) throw Error("Unexpected content in owned lifecycle hook block; config.toml was preserved.");
    if (fields.has(assignment[1])) throw Error("Duplicate owned lifecycle field; config.toml was preserved.");
    fields.add(assignment[1]);
    const raw = row.raw.slice(row.raw.indexOf("=") + 1).trim();
    if (assignment[1] === "timeout") { if (raw !== "3") throw Error("Invalid owned lifecycle timeout; config.toml was preserved."); }
    else {
      let value;
      try { value = JSON.parse(raw); } catch { throw Error("Invalid owned lifecycle command; config.toml was preserved."); }
      if (typeof value !== "string" || (assignment[1] === "type" && value !== "command")) throw Error("Invalid owned lifecycle handler; config.toml was preserved.");
    }
  }
  finishHandler();
  if (!events.length) throw Error("Empty owned lifecycle block; config.toml was preserved.");
  let start = first.start;
  if (text.slice(start - 2, start) === "\r\n") start -= 2;
  else if (text[start - 1] === "\n") start--;
  return { clean: text.slice(0, start) + text.slice(last.stop), events, present: true };
}
export function stripLifecycleHooks(text) { return managed(text).clean; }
function atomicWrite(target, text, expected) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.codex-rpc.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    if (read(target) !== expected) throw Error("Codex configuration changed during registration; retry setup. Existing changes were preserved.");
    replaceFile(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}
const quoteSh = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const quotePS = (value) => "'" + value.replaceAll("'", "''") + "'";
export function lifecycleCommands({ executable = process.execPath, entry = path.join(home(), "runtime/bin/codex-rpc.js") } = {}) {
  for (const value of [executable, entry, home(), codexHome()])
    if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) throw Error("Hook executable and paths must be nonempty strings without control characters");
  const command = `CODEX_RPC_HOME=${quoteSh(home())} CODEX_HOME=${quoteSh(codexHome())} ${[executable, entry, "hook"].map(quoteSh).join(" ")}`;
  const script = `$env:CODEX_RPC_HOME=${quotePS(home())}; $env:CODEX_HOME=${quotePS(codexHome())}; & ${[executable, entry, "hook"].map(quotePS).join(" ")}; exit $LASTEXITCODE`;
  return { command, commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}` };
}
export function installLifecycleHooks(options = {}) {
  const target = targetPath(), original = read(target), existing = managed(original), commands = lifecycleCommands(options);
  let table = "", hooksTable = false;
  for (const row of linesOf(existing.clean)) {
    if (/^\[/.test(row.visible)) { table = row.visible; hooksTable = /^\s*\[\s*(?:hooks|"hooks"|'hooks')\s*\]\s*(?:#.*)?$/.test(row.raw); }
    if ((!table && row.atStart && /^\s*(?:hooks|"hooks"|'hooks')(?:\s*\.\s*(?:[A-Za-z]+|"[A-Za-z]+"|'[A-Za-z]+'))?\s*=/.test(row.raw)) ||
      (hooksTable && lifecycleEvents.some((event) => new RegExp(`^\\s*(?:${event}|"${event}"|'${event}')\\s*=`).test(row.raw))) ||
      /^\s*\[\s*(?:hooks|"hooks"|'hooks')\s*\.\s*(?:[A-Za-z]+|"[A-Za-z]+"|'[A-Za-z]+')\s*\]\s*(?:#.*)?$/.test(row.raw))
      throw Error("Existing fixed-value hooks configuration cannot be extended safely; config.toml was preserved. Add codex-rpc hooks manually in /hooks-compatible array tables.");
  }
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const blocks = lifecycleEvents.map((event) => [
    `[[hooks.${event}]]`, `[[hooks.${event}.hooks]]`, 'type = "command"',
    `command = ${JSON.stringify(commands.command)}`, `command_windows = ${JSON.stringify(commands.commandWindows)}`, "timeout = 3",
  ].join(eol)).join(eol + eol);
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const backup = file("codex-config.backup.toml");
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });
  atomicWrite(target, existing.clean + eol + begin + eol + blocks + eol + end + eol, original);
  return inspectLifecycleHooks();
}
export function removeLifecycleHooks() {
  const target = targetPath(), original = read(target), clean = managed(original).clean;
  if (clean !== original) atomicWrite(target, clean, original);
}
export function inspectLifecycleHooks() {
  const target = targetPath(), sources = [], errors = [];
  let text = "";
  try { text = read(target); } catch (e) { errors.push(`Cannot inspect config.toml: ${e.message}`); }
  let owned = { present: false, events: [] };
  try { owned = managed(text); } catch (e) { errors.push(e.message); }
  if (owned.present) sources.push({ path: target, format: "inline", owned: true, events: owned.events });
  const userText = owned.present ? owned.clean : text;
  const userEvents = [...new Set(linesOf(userText).flatMap((row) => /^\[\[hooks\.([A-Za-z]+)\]\]$/.exec(row.visible)?.[1] || []))];
  if (userEvents.length) sources.push({ path: target, format: "inline", owned: false, events: userEvents });
  const jsonPath = path.join(codexHome(), "hooks.json");
  if (fs.existsSync(jsonPath)) {
    try { const json = JSON.parse(read(jsonPath)); sources.push({ path: jsonPath, format: "json", owned: false, events: Object.keys(json.hooks || {}) }); }
    catch (e) { errors.push(`Cannot inspect hooks.json: ${e.message}`); }
  }
  let featuresEnabled = null, table = "";
  for (const row of linesOf(userText)) {
    if (/^\[/.test(row.visible)) table = row.visible;
    if ((table === "[features]" && /^(?:hooks|codex_hooks)\s*=\s*(true|false)\s*$/.test(row.visible)) || (!table && /^features\.hooks\s*=\s*(true|false)\s*$/.test(row.visible))) featuresEnabled = /true\s*$/.test(row.visible);
  }
  const legacyNotify = { configured: linesOf(text).some((row) => /^notify\s*=/.test(row.visible)), owned: /^# codex-rpc notify begin\r?$/m.test(text) };
  return { path: target, configured: !errors.length && owned.events.length === lifecycleEvents.length, events: owned.events, eventCount: owned.events.length,
    expectedEvents: [...lifecycleEvents], sources, trust: "unknown", reviewRequired: true, guidance, legacyNotify, featuresEnabled, errors,
    warning: sources.some((source) => source.format === "json") && sources.some((source) => source.format === "inline") ? "Codex merges inline hooks and hooks.json and may warn about both representations; unrelated hooks were preserved." : null };
}

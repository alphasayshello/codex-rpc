// Metadata extraction only. Raw command lines, tool arguments, patch contents and
// tool output never leave these functions or enter the JSON state files.
import path from "node:path";
import { safeFilePath } from "./paths.js";
const bound = 1024 * 1024;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const words = (text) => (String(text).match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g) || []).map((word) => word.replace(/^(["'])(.*)\1$/, "$2"));
const subcommands = {
  npm: ["test", "run", "install", "ci", "build", "start", "exec", "audit", "outdated", "uninstall"],
  pnpm: ["test", "run", "install", "build", "start", "exec", "lint", "check"],
  yarn: ["test", "run", "install", "build", "start", "lint", "check"],
  git: ["status", "diff", "log", "show", "commit", "push", "pull", "fetch", "checkout", "switch", "branch", "add", "restore", "rev-parse"],
  cargo: ["test", "build", "check", "run", "fmt", "clippy"],
  go: ["test", "build", "run", "fmt", "vet", "mod"],
  docker: ["build", "run", "compose", "ps", "logs", "images"],
};
const executables = new Set([...Object.keys(subcommands), "node", "python", "python3", "pytest", "npx", "bash", "sh", "zsh", "powershell", "pwsh", "make", "cmake", "rg", "grep", "find", "ls", "cat", "sed", "awk", "curl", "wget", "deno", "bun"]);
export function summarizeCommand(command) {
  if (Array.isArray(command)) command = command.slice(0, 4).filter((value) => typeof value === "string").join(" ");
  if (typeof command !== "string" || command.length > bound) return undefined;
  // Only inspect the first invocation. Never retain assignment values, flags,
  // file operands, URLs, script paths, arbitrary npm task names or shell output.
  const tokens = words(command.split(/[\r\n;&|]/, 1)[0]);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (!tokens.length) return undefined;
  const executable = path.win32.basename(path.posix.basename(tokens[0])).replace(/\.exe$/i, "").toLowerCase();
  if (!executables.has(executable)) return undefined;
  const summary = [executable];
  if (subcommands[executable]?.includes(tokens[1])) {
    summary.push(tokens[1]);
    if (["npm", "pnpm", "yarn"].includes(executable) && tokens[1] === "run" &&
      ["test", "build", "lint", "check", "format", "typecheck", "dev", "start", "preview"].includes(tokens[2])) summary.push(tokens[2]);
  }
  return summary.join(" ").slice(0, 64);
}
export function patchTelemetry(patch) {
  if (typeof patch !== "string" || patch.length > bound) return {};
  const safeFiles = [], addFile = (value) => {
    const safe = safeFilePath(value);
    if (safe && !safeFiles.includes(safe) && safeFiles.length < 32) safeFiles.push(safe);
  };
  let recognized = false, section = false, mode = "", hunk = false, deletedUnknown = false, added = 0, removed = 0;
  for (const line of patch.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/);
    if (header) {
      recognized = section = true;
      mode = "apply";
      addFile(header[2]);
      if (header[1] === "Delete File") deletedUnknown = true;
      continue;
    }
    if (/^diff --git /.test(line)) { recognized = true; section = false; mode = "unified"; hunk = false; continue; }
    const unified = line.match(/^(?:---|\+\+\+) (.+?)(?:\t.*)?$/);
    if (unified && mode !== "apply" && !hunk) {
      recognized = section = true;
      mode = "unified";
      if (unified[1] !== "/dev/null") addFile(unified[1].replace(/^[ab]\//, ""));
      continue;
    }
    if (line === "*** End Patch") { section = false; continue; }
    if (mode === "unified" && /^@@/.test(line)) { hunk = true; continue; }
    if (!section || (mode === "unified" && !hunk)) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return recognized ? { safeFiles, linesAdded: added, ...(deletedUnknown ? {} : { linesRemoved: removed }) } : {};
}
function replacementLines(oldValue, newValue) {
  if (typeof oldValue !== "string" || typeof newValue !== "string") return {};
  const lines = (value) => value === "" ? [] : value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const before = lines(oldValue), after = lines(newValue);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before.at(-1 - end) === after.at(-1 - end)) end++;
  const oldLines = before.slice(start, before.length - end), newLines = after.slice(start, after.length - end);
  if (oldLines.length * newLines.length > 2e6) return {};
  let previous = new Uint32Array(newLines.length + 1), current = new Uint32Array(newLines.length + 1);
  for (const oldLine of oldLines) {
    for (let j = 1; j <= newLines.length; j++) current[j] = oldLine === newLines[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    [previous, current] = [current, previous]; current.fill(0);
  }
  const common = previous[newLines.length];
  return { linesAdded: newLines.length - common, linesRemoved: oldLines.length - common };
}
export function toolTelemetry(input) {
  const p = input.payload || input;
  const name = String(input.tool || p.name || "").toLowerCase();
  let args = p.arguments ?? p.tool_input ?? {};
  if (typeof args === "string") {
    try { args = args.length <= bound ? JSON.parse(args) : {}; } catch { args = {}; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  const patch = /(?:^|[_.])apply_patch$/.test(name) ? p.input ?? args.patch ?? args.input ?? p.patch : args.patch;
  const wrapped = /(?:^|\.)exec$/.test(name) ? wrapperTelemetry(p.input ?? args.code ?? args.input) : {};
  const telemetry = { ...patchTelemetry(patch), ...wrapped };
  const safeFiles = [...(telemetry.safeFiles || [])];
  const add = (value) => {
    const safe = safeFilePath(value);
    if (safe && !safeFiles.includes(safe) && safeFiles.length < 32) safeFiles.push(safe);
  };
  [input.file, args.file_path, args.path, p.file_path, ...(Array.isArray(args.file_paths) ? args.file_paths : [])].forEach(add);
  if (Array.isArray(args.files)) args.files.slice(0, 32).forEach((value) => add(typeof value === "string" ? value : value?.file_path || value?.path));
  if (telemetry.linesAdded === undefined && /edit|replace|write/.test(name)) Object.assign(telemetry, replacementLines(args.old_string ?? args.old_text ?? args.old_content, args.new_string ?? args.new_text ?? args.new_content));
  for (const field of ["linesAdded", "linesRemoved"]) {
    const explicit = count(input[field] ?? p[field === "linesAdded" ? "lines_added" : "lines_removed"]);
    if (explicit !== undefined) telemetry[field] = explicit;
  }
  if (safeFiles.length) { telemetry.safeFiles = safeFiles; telemetry.file = safeFiles[0]; }
  else delete telemetry.safeFiles;
  if (/bash|shell|exec_command|terminal|run_command/.test(name)) {
    const command = args.cmd ?? args.command ?? p.command ?? input.command ?? input.cmd;
    const summary = summarizeCommand(command);
    if (summary) telemetry.commandSummary = summary;
  }
  if (!telemetry.operationKind) {
    if (/patch|edit|write|replace|create_file/.test(name)) telemetry.operationKind = "editing";
    else if (/bash|shell|exec_command|terminal|run_command/.test(name)) telemetry.operationKind = "shell";
  }
  return telemetry;
}

// A deliberately small lexer, not an evaluator. Wrapper telemetry is accepted
// only from literal call sites; dynamic JavaScript stays unknown. Literal spans
// (including template interpolations), comments and regexes cannot invent calls.
function wrapperTokens(code) {
  if (typeof code !== "string" || code.length > bound) return [];
  const tokens = [];
  const commentEnd = (i) => code[i + 1] === "/" ? (code.indexOf("\n", i + 2) < 0 ? code.length : code.indexOf("\n", i + 2))
    : code.indexOf("*/", i + 2) < 0 ? code.length : code.indexOf("*/", i + 2) + 2;
  function literal(start, depth = 0) {
    if (depth > 16) return { end: code.length, static: false };
    const quote = code[start];
    let value = "", known = true, i = start + 1;
    while (i < code.length) {
      const character = code[i++];
      if (character === quote) return { end: i, value, static: known };
      if (character === "\\") {
        const escaped = code[i++];
        const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
        if (escaped === "\n") continue;
        if (escaped === "\r") { if (code[i] === "\n") i++; continue; }
        if (escaped === "x" || escaped === "u") {
          let digits, length = escaped === "x" ? 2 : 4;
          if (escaped === "u" && code[i] === "{") {
            const end = code.indexOf("}", i + 1);
            digits = end < 0 ? "" : code.slice(i + 1, end);
            i = end < 0 ? code.length : end + 1;
            if (!/^[a-f0-9]{1,6}$/i.test(digits) || parseInt(digits, 16) > 0x10ffff) known = false;
          } else {
            digits = code.slice(i, i + length); i += length;
            if (!new RegExp(`^[a-f0-9]{${length}}$`, "i").test(digits)) known = false;
          }
          if (known) value += String.fromCodePoint(parseInt(digits, 16));
        } else if (escaped !== undefined) value += escapes[escaped] ?? escaped;
        else known = false;
        continue;
      }
      if (quote === "`" && character === "$" && code[i] === "{") {
        known = false;
        i++;
        let braces = 1;
        while (i < code.length && braces) {
          if (["'", '"', "`"].includes(code[i])) { i = literal(i, depth + 1).end; continue; }
          if (code[i] === "/" && ["/", "*"].includes(code[i + 1])) { i = commentEnd(i); continue; }
          if (code[i] === "{") braces++;
          if (code[i] === "}") braces--;
          i++;
        }
        continue;
      }
      if (quote !== "`" && /[\r\n]/.test(character)) known = false;
      value += character;
    }
    return { end: code.length, static: false };
  }
  for (let i = 0; i < code.length;) {
    if (tokens.length > 50000) return [];
    if (/\s/.test(code[i])) { i++; continue; }
    if (code[i] === "/" && ["/", "*"].includes(code[i + 1])) { i = commentEnd(i); continue; }
    if (["'", '"', "`"].includes(code[i])) {
      const item = literal(i); tokens.push({ type: "literal", value: item.static ? item.value : null }); i = item.end; continue;
    }
    const previous = tokens.at(-1)?.value;
    if (code[i] === "/" && (previous === undefined || ["=", "(", ":", ",", "[", "{", "!", "?", "return", ">"].includes(previous))) {
      i++; let bracket = false;
      while (i < code.length) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === "[") bracket = true;
        else if (code[i] === "]") bracket = false;
        else if (code[i] === "/" && !bracket) { i++; break; }
        if (/[\r\n]/.test(code[i])) break;
        i++;
      }
      while (/[a-z]/i.test(code[i] || "") && i < code.length) i++;
      tokens.push({ type: "unknown", value: null }); continue;
    }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
    if (identifier) { tokens.push({ type: "identifier", value: identifier[0] }); i += identifier[0].length; }
    else tokens.push({ type: "punctuation", value: code[i++] });
    if (tokens.length > 50000) return [];
  }
  return tokens;
}
function literalCommand(tokens, start) {
  if (tokens[start]?.value !== "{") return undefined;
  let depth = 1, command, invalid = false, end = start + 1;
  for (; end < tokens.length && depth; end++) {
    const token = tokens[end], value = token.value;
    if (depth === 1) {
      if (value === "cmd" && ["get", "set"].includes(tokens[end - 1]?.value)) invalid = true;
      if (value === "." && tokens[end + 1]?.value === "." && tokens[end + 2]?.value === ".") invalid = true;
      if (value === "[" && ["{", ","].includes(tokens[end - 1]?.value)) invalid = true;
      if ((token.type === "identifier" || token.type === "literal") && value === "cmd" && ["{", ","].includes(tokens[end - 1]?.value)) {
        const literal = tokens[end + 2];
        command = tokens[end + 1]?.value === ":" && literal?.type === "literal" && literal.value != null &&
          [",", "}"].includes(tokens[end + 3]?.value) ? literal.value : undefined;
      }
    }
    if (token.type === "punctuation" && ["{", "[", "("].includes(value)) depth++;
    if (token.type === "punctuation" && ["}", "]", ")"].includes(value)) depth--;
  }
  return !invalid && depth === 0 && tokens[end]?.value === ")" ? command : undefined;
}
export function wrapperTelemetry(code) {
  const tokens = wrapperTokens(code), patches = [], commands = [];
  for (let i = 0; i + 4 < tokens.length; i++) {
    if (tokens[i].type !== "identifier" || tokens[i].value !== "tools" || tokens[i - 1]?.value === "." ||
      tokens[i + 1]?.value !== "." || tokens[i + 2]?.type !== "identifier" || tokens[i + 3]?.value !== "(") continue;
    const method = tokens[i + 2].value;
    if (method === "apply_patch" && tokens[i + 4]?.type === "literal" && tokens[i + 4].value != null && tokens[i + 5]?.value === ")") {
      const patch = patchTelemetry(tokens[i + 4].value);
      if (patch.safeFiles?.length) patches.push(patch);
    }
    if (method === "exec_command") {
      const summary = summarizeCommand(literalCommand(tokens, i + 4));
      if (summary) commands.push(summary);
    }
  }
  const result = {};
  if (patches.length) {
    result.safeFiles = [...new Set(patches.flatMap((patch) => patch.safeFiles))].slice(0, 32);
    result.file = result.safeFiles[0];
    for (const field of ["linesAdded", "linesRemoved"])
      if (patches.every((patch) => patch[field] !== undefined)) result[field] = patches.reduce((sum, patch) => sum + patch[field], 0);
    result.effectiveTool = "apply_patch"; result.operationKind = "editing";
  } else if (commands.length) { result.effectiveTool = "exec_command"; result.operationKind = "shell"; }
  if (commands.length) result.commandSummary = commands[0];
  return result;
}

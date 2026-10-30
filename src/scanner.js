import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  codexHome,
  readJSON,
  writeJSON,
  file,
  home,
  config,
  isMain,
  alive,
} from "./store.js";
import { conversationName } from "./threads.js";
import { estimateCost } from "./pricing.js";
import { applyEvent, normalizeEvent } from "./hook.js";
export function emptyStats() {
  return {
    prompts: 0,
    toolCalls: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cached: 0,
    tokens: 0,
    sessions: 0,
    activeSeconds: 0,
    linesAdded: 0,
    linesRemoved: 0,
    cost: 0,
    unknownCostTokens: 0,
    tools: {},
    languages: {},
    files: {},
    commands: {},
    hours: Array(24).fill(0),
    sources: { codex: 0, chatgpt: 0 },
    sourceHours: { codex: 0, chatgpt: 0 },
    sourceSessions: { codex: 0, chatgpt: 0 },
  };
}
export function mergeStats(to, from) {
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === "number") to[k] = (to[k] || 0) + v;
    else if (Array.isArray(v)) v.forEach((n, i) => (to[k][i] += n));
    else if (v && typeof v === "object")
      for (const [a, b] of Object.entries(v)) to[k][a] = (to[k][a] || 0) + b;
  }
  return to;
}
function bump(obj, k, n = 1) {
  if (k) obj[k] = (obj[k] || 0) + n;
}
export function walk(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((d) =>
        d.isSymbolicLink()
          ? []
          : d.isDirectory()
            ? walk(path.join(dir, d.name))
            : d.name.endsWith(".jsonl")
              ? [path.join(dir, d.name)]
              : [],
      );
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
const lang = {
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  jsx: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  sh: "Shell",
  css: "CSS",
  html: "HTML",
  md: "Markdown",
  json: "JSON",
  cpp: "C++",
  c: "C",
  rb: "Ruby",
  swift: "Swift",
};
function usageOf(u = {}) {
  return {
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    reasoning:
      Number(
        u.reasoning_output_tokens ?? u.output_tokens_details?.reasoning_tokens,
      ) || 0,
    cached:
      Number(u.cached_input_tokens ?? u.input_tokens_details?.cached_tokens) ||
      0,
  };
}
export { safeFilePath } from "./paths.js";
import { safeFilePath } from "./paths.js";
export async function parseFile(filename) {
  const result = {
    totals: emptyStats(),
    days: {},
    sessionIds: [],
    sessions: {},
    latest: null,
  };
  let model = "unknown", source = "codex", session = filename;
  const seen = new Set();
  const accounting = new Map();
  function sessionData(id) {
    if (!result.sessions[id]) {
      result.sessions[id] = {
        id, source, model: "unknown", startedAt: 0, lastActivityAt: 0,
        totals: emptyStats(), usageKnown: false, recentTools: [],
      };
      accounting.set(id, {
        previousUsage: {}, lastTime: 0, modernUsage: {}, legacyUsage: {},
        fallbackPrompts: {}, hasModernUsage: false, hasPromptEvents: false,
      });
    }
    return result.sessions[id];
  }
  const titles = new Map();
  const stream = fs.createReadStream(filename, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const p = row.payload || row,
      type = p.type || row.type;
    if (row.type === "session_meta") {
      session = p.id || session;
      source = /chatgpt/i.test(p.originator || p.source || "")
        ? "chatgpt"
        : "codex";
    }
    if (row.session_id) session = row.session_id;
    const chat = sessionData(session), ledger = accounting.get(session);
    source = chat.source;
    if (row.type === "session_meta") {
      source = /chatgpt/i.test(p.originator || p.source || "") ? "chatgpt" : "codex";
      chat.source = source;
    }
    model = row.model || p.model || chat.model;
    chat.model = model;
    const parsed = Date.parse(
      row.timestamp ||
        p.timestamp ||
        (row.ts ? new Date(row.ts * 1000).toISOString() : ""),
    );
    const time = Number.isFinite(parsed) ? parsed : 0;
    if (time) {
      chat.startedAt = chat.startedAt ? Math.min(chat.startedAt, time) : time;
      chat.lastActivityAt = Math.max(chat.lastActivityAt, time);
    }
    const day = time ? new Date(time).toISOString().slice(0, 10) : "unknown";
    const delta = emptyStats();
    const id = p.call_id || p.response_id || p.id || row.id;
    const isTool = ["function_call", "custom_tool_call", "tool_call"].includes(
      type,
    );
    const dedupKey = id ? `${session}:${isTool ? "tool" : type}:${id}` : null;
    if (dedupKey && seen.has(dedupKey)) continue;
    if (dedupKey) seen.add(dedupKey);
    // Prefer semantic user_message events when present. Newer app logs have
    // only response items, so keep those as a per-session fallback.
    const semanticPrompt = type === "user_message";
    const fallbackPrompt = row.type === "response_item" && p.role === "user";
    const historyPrompt = !!(p.text && row.session_id);
    if (semanticPrompt || fallbackPrompt || historyPrompt) {
      if (semanticPrompt) ledger.hasPromptEvents = true;
      const text =
        p.message ||
        p.text ||
        (Array.isArray(p.content)
          ? p.content.map((x) => x.text || "").join("")
          : p.content) ||
        "";
      const turn = p.internal_chat_message_metadata_passthrough?.turn_id;
      const key = `prompt:${session}:${semanticPrompt ? "event" : "fallback"}:${turn || text}:${Math.floor(time / 10000)}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (semanticPrompt || historyPrompt) delta.prompts++;
        else {
          const candidate = emptyStats();
          candidate.prompts = 1;
          candidate.sources[source] = 1;
          if (time) candidate.hours[new Date(time).getUTCHours()]++;
          mergeStats((ledger.fallbackPrompts[day] ||= emptyStats()), candidate);
        }
      }
    }
    if (isTool) {
      const tool = { name: p.name || "unknown", startedAt: time };
      if (p.call_id) tool.callId = p.call_id;
      chat.recentTools.push(tool);
      chat.recentTools = chat.recentTools.slice(-8);
      delta.toolCalls++;
      bump(delta.tools, p.name || "unknown");
      let args = p.arguments || p.input || {};
      try {
        if (typeof args === "string") args = JSON.parse(args);
      } catch {
        args = { patch: args };
      }
      const command = args.command || args.cmd;
      if (command) bump(delta.commands, String(command).trim().split(/\s+/)[0]);
      let patch =
        typeof args === "string" ? args : args.patch || args.input || "";
      if (p.name === "apply_patch" && typeof p.input === "string")
        patch = p.input;
      const paths = [
        args.file_path,
        args.path,
        ...String(patch).matchAll(/^\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)\r?$/gm),
      ]
        .map((x) => (Array.isArray(x) ? x[1] : x))
        .map(safeFilePath)
        .filter(Boolean);
      for (const f of new Set(paths)) {
        bump(delta.files, f);
        bump(delta.languages, lang[path.extname(f).slice(1)] || "Other");
      }
      for (const l of String(patch).split("\n")) {
        if (l.startsWith("+") && !l.startsWith("+++")) delta.linesAdded++;
        if (l.startsWith("-") && !l.startsWith("---")) delta.linesRemoved++;
      }
    }
    if (["function_call_output", "custom_tool_call_output", "tool_result"].includes(type)) {
      const tool = [...chat.recentTools].reverse().find((x) => p.call_id && x.callId === p.call_id);
      if (tool && tool.startedAt && time >= tool.startedAt) {
        tool.endedAt = time;
        tool.durationMs = time - tool.startedAt;
      }
    }
    let usage = null;
    if (type === "token_count") {
      const info = p.info || {};
      if (info.total_token_usage) {
        const total = usageOf(info.total_token_usage),
          prev = ledger.previousUsage;
        usage = Object.fromEntries(
          Object.entries(total).map(([k, v]) => [
            k,
            Math.max(0, v - (prev[k] || 0)),
          ]),
        );
        ledger.previousUsage = total;
      } else if (info.last_token_usage) usage = usageOf(info.last_token_usage);
    } else if (p.usage) usage = usageOf(p.usage);
    if (usage) {
      chat.usageKnown = true;
      const usageStats = emptyStats();
      Object.assign(usageStats, usage);
      usageStats.tokens = usage.input + usage.output;
      const cost = estimateCost(model, usage);
      if (cost === null) usageStats.unknownCostTokens = usageStats.tokens;
      else usageStats.cost = cost;
      if (time && usageStats.tokens)
        usageStats.hours[new Date(time).getUTCHours()]++;
      const modern = row.type === "token_usage_record";
      if (modern) ledger.hasModernUsage = true;
      const bucket = modern ? ledger.modernUsage : ledger.legacyUsage;
      mergeStats((bucket[day] ||= emptyStats()), usageStats);
    }
    if (time && ledger.lastTime && time >= ledger.lastTime)
      delta.activeSeconds = Math.min(300, (time - ledger.lastTime) / 1000);
    if (time) ledger.lastTime = Math.max(time, ledger.lastTime);
    if (time && (delta.prompts || delta.toolCalls || delta.tokens))
      delta.hours[new Date(time).getUTCHours()]++;
    delta.sourceHours[source] = delta.activeSeconds / 3600;
    delta.sources[source] = delta.prompts + delta.toolCalls;
    mergeStats(chat.totals, delta);
    mergeStats(result.totals, delta);
    mergeStats((result.days[day] ||= emptyStats()), delta);
    if (!result.sessionIds.includes(session)) {
      result.sessionIds.push(session);
      chat.totals.sessions = 1;
      chat.totals.sourceSessions[source] = 1;
      result.totals.sessions++;
      result.days[day].sessions++;
      result.totals.sourceSessions[source]++;
      result.days[day].sourceSessions[source]++;
    }
    if (!titles.has(session)) titles.set(session, conversationName(session));
    const event = normalizeEvent({
      ...row,
      source,
      model,
      task: titles.get(session),
      sessionId: session,
    });
    if (event) {
      if (config().privacy !== "public" || !config().presence.showTask)
        delete event.task;
      result.latest = { ...event, type: event.status };
    }
  }
  for (const [id, ledger] of accounting) {
    const chat = result.sessions[id];
    for (const bucket of [
      ledger.hasModernUsage ? ledger.modernUsage : ledger.legacyUsage,
      ledger.hasPromptEvents ? {} : ledger.fallbackPrompts,
    ]) {
      for (const [day, stats] of Object.entries(bucket)) {
        mergeStats(chat.totals, stats);
        mergeStats(result.totals, stats);
        mergeStats((result.days[day] ||= emptyStats()), stats);
      }
    }
  }
  return result;
}
export function streaks(days, now = new Date()) {
  const active = Object.keys(days)
    .filter(
      (d) =>
        d !== "unknown" &&
        (days[d].prompts ||
          days[d].toolCalls ||
          days[d].tokens ||
          days[d].activeSeconds),
    )
    .sort();
  let longest = 0,
    run = 0,
    prev = 0;
  for (const d of active) {
    const t = Date.parse(d);
    run = t - prev === 86400000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  let current = 0,
    today = Date.parse(now.toISOString().slice(0, 10));
  if (!active.includes(new Date(today).toISOString().slice(0, 10)))
    today -= 86400000;
  while (active.includes(new Date(today).toISOString().slice(0, 10))) {
    current++;
    today -= 86400000;
  }
  return { current, longest };
}
export async function scan({ live = false } = {}) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = fs.openSync(file("scanner.lock"), "wx", 0o600);
    fs.writeFileSync(lock, String(process.pid));
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const age = Date.now() - fs.statSync(file("scanner.lock")).mtimeMs;
    const owner = Number(fs.readFileSync(file("scanner.lock"), "utf8"));
    if (alive(owner) || (!owner && age < 600000))
      return readJSON("aggregate.json", { totals: emptyStats(), days: {} });
    fs.unlinkSync(file("scanner.lock"));
    return scan({ live });
  }
  try {
    const cache = readJSON("scanner-cache.json", { files: {} }),
      next = { schemaVersion: 6, files: {} };
    if (!config().enabled || !config().stats.enabled)
      return readJSON("aggregate.json", {
        schemaVersion: 1,
        updatedAt: 0,
        totals: emptyStats(),
        days: {},
        streak: { current: 0, longest: 0 },
      });
    const files = walk(path.join(codexHome(), "sessions"));
    // Prefer session logs; history has no token/tool data and overlaps prompts.
    if (!files.length && fs.existsSync(path.join(codexHome(), "history.jsonl")))
      files.push(path.join(codexHome(), "history.jsonl"));
    const aggregate = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      totals: emptyStats(),
      days: {},
      streak: { current: 0, longest: 0 },
      filesScanned: 0,
      filesReused: 0,
    };
    const sessions = { schemaVersion: 1, updatedAt: aggregate.updatedAt, sessions: {} };
    let latest;
    if (!config().enabled || !config().stats.enabled)
      return readJSON("aggregate.json", aggregate);
    for (const filename of files) {
      const st = fs.statSync(filename),
        old = cache.files[filename];
      const cached =
        cache.schemaVersion === 6 &&
        old &&
        old.size === st.size &&
        old.mtimeMs === st.mtimeMs;
      const entry = cached
        ? old
        : {
            size: st.size,
            mtimeMs: st.mtimeMs,
            data: await parseFile(filename),
          };
      aggregate[cached ? "filesReused" : "filesScanned"]++;
      next.files[filename] = entry;
      mergeStats(aggregate.totals, entry.data.totals);
      for (const [d, s] of Object.entries(entry.data.days))
        mergeStats((aggregate.days[d] ||= emptyStats()), s);
      for (const [id, chat] of Object.entries(entry.data.sessions)) {
        const existing = sessions.sessions[id];
        if (!existing) sessions.sessions[id] = structuredClone(chat);
        else {
          mergeStats(existing.totals, chat.totals);
          existing.totals.sessions = 1;
          existing.totals.sourceSessions[chat.source] = 1;
          existing.startedAt = Math.min(existing.startedAt || Infinity, chat.startedAt || Infinity);
          if (!Number.isFinite(existing.startedAt)) existing.startedAt = 0;
          if (chat.lastActivityAt >= existing.lastActivityAt) {
            existing.source = chat.source;
            existing.model = chat.model;
          }
          existing.lastActivityAt = Math.max(existing.lastActivityAt, chat.lastActivityAt);
          existing.usageKnown ||= chat.usageKnown;
          const seenTools = new Set();
          existing.recentTools = [...existing.recentTools, ...chat.recentTools]
            .sort((a, b) => a.startedAt - b.startedAt)
            .filter((tool) => {
              const key = tool.callId || `${tool.name}:${tool.startedAt}`;
              if (seenTools.has(key)) return false;
              seenTools.add(key);
              return true;
            }).slice(-8);
        }
      }
      const event = entry.data.latest;
      if (
        event &&
        (!latest || Date.parse(event.timestamp) > Date.parse(latest.timestamp))
      )
        latest = event;
    }
    const desktop = readJSON("desktop-aggregate.json", { days: {} });
    for (const [day, stats] of Object.entries(desktop.days || {})) {
      mergeStats(aggregate.totals, stats);
      mergeStats((aggregate.days[day] ||= emptyStats()), stats);
    }
    aggregate.totals.activeHours = aggregate.totals.activeSeconds / 3600;
    aggregate.streak = streaks(aggregate.days);
    if (config().privacy === "private") {
      aggregate.totals.files = {};
      for (const s of Object.values(aggregate.days)) s.files = {};
      for (const chat of Object.values(sessions.sessions)) chat.totals.files = {};
    }
    writeJSON("scanner-cache.json", next);
    writeJSON("sessions.json", sessions);
    writeJSON("aggregate.json", aggregate);
    if (
      live &&
      latest &&
      Date.now() - Date.parse(latest.timestamp) < config().timing.idleMs
    )
      applyEvent(latest);
    return aggregate;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(file("scanner.lock"));
  }
}
if (isMain(import.meta.url))
  scan({ live: process.argv.includes("--live") }).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });

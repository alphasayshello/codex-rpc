import { safeFilePath } from "./paths.js";
import path from "node:path";
import { taskTitle } from "./presence.js";
import { conversationName } from "./threads.js";
import { isMain, readJSON, writeJSON, config } from "./store.js";
import { liveSessionFile, readLiveSession, normalizeUsage } from "./live.js";
const states = {
  working: "working",
  thinking: "thinking",
  waiting: "waiting",
  idle: "idle",
  "session-start": "waiting",
  "turn-start": "thinking",
  task_started: "thinking",
  user_message: "thinking",
  "tool-start": "working",
  function_call: "working",
  custom_tool_call: "working",
  "tool-end": "thinking",
  function_call_output: "thinking",
  custom_tool_call_output: "thinking",
  turn_aborted: "waiting",
  error: "waiting",
  task_failed: "waiting",
  "approval-request": "waiting",
  "agent-turn-complete": "waiting",
  task_complete: "waiting",
  "session-end": "idle",
  "app-background": "idle",
  "app-closed": "idle",
  "app-active": "waiting",
};
// Keep outcome metadata, never the output it came from. Terminal wrappers have
// stable exit markers; arbitrary occurrences of "error" in stdout prove nothing.
export function toolOutcome(input) {
  const p = input.payload || input;
  let output = p.output ?? input.output;
  if (typeof output === "string") {
    const prefix = output.slice(0, 4096);
    try {
      output = output.length <= 65536 ? JSON.parse(output) : null;
    } catch { output = null; }
    if (!output || typeof output !== "object") {
      const match = prefix.match(/^(?:Process exited with code\s+|Exit code:\s*|Command failed with exit code\s+)(-?\d+)\s*$/m);
      output = match ? { exit_code: Number(match[1]) } : {};
    }
  }
  const objects = [input, p, output, output?.metadata].filter((v) => v && typeof v === "object");
  const codes = objects.flatMap((v) => [v.exitCode, v.exit_code]).filter((v) => typeof v === "number" && Number.isSafeInteger(v));
  const exitCode = codes.find((code) => code !== 0) ?? codes[0];
  const failed = objects.some((v) => v.is_error === true || v.isError === true || ["failed", "error", "cancelled", "canceled"].includes(v.status)) || (exitCode != null && exitCode !== 0);
  return { status: failed ? "failed" : "completed", ...(exitCode != null ? { exitCode } : {}) };
}
export function normalizeEvent(input) {
  const p = input.payload || input;
  const type = p.type || input.type;
  let status = states[type];
  if (
    type === "reasoning" ||
    (p.role === "assistant" && p.content?.some?.((x) => x.type === "reasoning"))
  )
    status = "thinking";
  if (p.role === "user") status = "thinking";
  if (!status) return null;
  let args = p.arguments || p.tool_input || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const filename = safeFilePath(input.file || args?.file_path || args?.path || p.file_path);
  return {
    status,
    type,
    tokenOnly: input.tokenOnly === true,
    callId: p.call_id || input.callId || input.call_id || p.id,
    usage: normalizeUsage(input.usage || p.thread_token_usage || p.info?.total_token_usage),
    lastUsage: normalizeUsage(input.lastUsage || p.info?.last_token_usage),
    contextWindow: input.contextWindow ?? p.info?.model_context_window ?? p.model_context_window,
    source: input.source || p.source || "codex",
    sessionId: input["thread-id"] || input.thread_id || p.session_id || input.sessionId || p.thread_id,
    project:
      input.project ||
      (input.cwd || p.cwd ? path.basename(input.cwd || p.cwd) : undefined),
    task: taskTitle(input.threadName || input.task || p.thread_name),
    waitingReason: ["error", "task_failed"].includes(type)
      ? "error"
      : type === "approval-request"
        ? "approval"
        : ["done", "approval", "error", "ready"].includes(input.waitingReason)
          ? input.waitingReason
          : ["agent-turn-complete", "task_complete", "waiting"].includes(type)
            ? "done"
            : undefined,
    model: input.model || p.model,
    tool: input.tool || p.name,
    file: filename || undefined,
    tokens: input.tokens ?? p.info?.total_token_usage?.total_tokens,
    timestamp: input.timestamp,
    outcome: ["tool-end", "function_call_output", "custom_tool_call_output"].includes(type) ? toolOutcome(input) : undefined,
  };
}
export function applyEvent(input) {
  const e = normalizeEvent(input);
  if (!e) return null;
  const c = config();
  if (!c.enabled) return null;
  const source = e.source === "chatgpt" ? "chatgpt" : "codex";
  const selectedSource = readJSON(`${source}-state.json`);
  const sessionId = e.sessionId || selectedSource.sessionId;
  const saved = readLiveSession(sessionId, source);
  const prior = sessionId
    ? (saved.sessionId ? saved : selectedSource.sessionId === sessionId ? selectedSource : {})
    : selectedSource;
  e.sessionId = sessionId;
  if (c.privacy === "public" && c.presence.showTask) {
    const title = conversationName(e.sessionId || prior.sessionId);
    if (title) {
      e.task = title;
      e.taskSource = "thread";
    } else if (e.task) e.taskSource = "explicit";
  }
  const time = Date.now(),
    eventTime = Date.parse(e.timestamp) || time;
  if (prior.eventTime > eventTime) return prior;
  const next = {
    ...prior,
    status: e.status,
    source,
    updatedAt: time,
    eventTime,
    startedAt:
      !prior.startedAt || (e.sessionId && e.sessionId !== prior.sessionId)
        ? eventTime
        : prior.startedAt,
  };
  for (const k of [
    "sessionId",
    "project",
    "task",
    "taskSource",
    "waitingReason",
    "model",
    "tool",
    "file",
    "tokens",
    "lastUsage",
    "contextWindow",
  ])
    if (e[k] !== undefined) next[k] = e[k];
  if (e.sessionId && e.sessionId !== prior.sessionId && !e.task) {
    delete next.task;
    delete next.taskSource;
  }
  if (!e.task && !prior.taskSource) delete next.task;
  if (e.usage) {
    next.usage = e.usage;
    next.tokens = e.usage.total;
  } else if (e.tokens !== undefined) {
    next.tokens = Math.max(0, Number(e.tokens) || 0);
    if (next.usage) next.usage = { ...next.usage, total: next.tokens };
  }
  const starts = ["tool-start", "function_call", "custom_tool_call"].includes(e.type);
  const ends = ["tool-end", "function_call_output", "custom_tool_call_output"].includes(e.type);
  let active = [...(prior.activeTools || [])];
  let recent = [...(prior.recentTools || [])];
  const seen = [...(prior.toolCallIds || [])];
  if (starts && !e.tokenOnly) {
    const callId = String(e.callId || `${e.tool || "tool"}:${eventTime}`);
    if (!seen.includes(callId)) {
      seen.push(callId);
      const tool = { name: String(e.tool || "tool").slice(0, 128), callId, status: "running", startedAt: eventTime, ...(c.privacy === "public" && e.file ? { file: e.file } : {}) };
      active.push(tool);
      recent = [...recent.filter((t) => t.callId !== callId), tool].slice(-50);
      next.lastTool = tool;
    } else if (!active.some((t) => t.callId === callId)) {
      // Replayed completed calls cannot revive an old working state.
      next.status = prior.status || "thinking";
      next.tool = prior.tool;
    }
  } else if (ends && !e.tokenOnly) {
    const target = e.callId ? String(e.callId) : active.at(-1)?.callId;
    const tool = active.find((t) => t.callId === target);
    if (tool) {
      const completed = { ...tool, ...e.outcome, endedAt: eventTime, durationMs: Math.max(0, eventTime - tool.startedAt) };
      recent = [...recent.filter((t) => t.callId !== target), completed].slice(-50);
      next.lastTool = completed;
      active = active.filter((t) => t.callId !== target);
    }
  } else if (["waiting", "idle"].includes(e.status) && !e.tokenOnly) {
    recent = recent.map((t) => active.some((a) => a.callId === t.callId)
      ? { ...t, status: "unknown", endedAt: eventTime, durationMs: Math.max(0, eventTime - t.startedAt) } : t);
    if (active.length) next.lastTool = recent.at(-1);
    active = [];
  }
  next.activeTools = active;
  next.recentTools = recent;
  next.toolCallIds = seen;
  next.observedToolCalls = seen.length;
  if (active.length && (starts || ends || e.tokenOnly)) {
    next.status = "working";
    next.tool = active.at(-1).name;
    if (active.at(-1).file) next.file = active.at(-1).file;
    else delete next.file;
  }
  if (next.status !== "working") { delete next.tool; delete next.file; }
  if (e.status !== "waiting") delete next.waitingReason;
  if (c.privacy === "private" || !c.presence.showTask) delete next.task;
  if (c.privacy === "private") {
    delete next.project;
    delete next.file;
    delete next.task;
    // A privacy change must also redact metadata collected while public.
    next.activeTools = next.activeTools.map(({ file, ...tool }) => tool);
    next.recentTools = next.recentTools.map(({ file, ...tool }) => tool);
    if (next.lastTool) {
      const { file, ...tool } = next.lastTool;
      next.lastTool = tool;
    }
  }
  if (sessionId) writeJSON(liveSessionFile(sessionId, source), next);
  // Old log records may refresh their own conversation, but must never switch
  // the visible conversation back from a newer event in another chat.
  if (selectedSource.eventTime > eventTime) return next;
  writeJSON(`${source}-state.json`, next);
  const other = readJSON(
    `${source === "codex" ? "chatgpt" : "codex"}-state.json`,
  );
  const selected =
    source === "chatgpt" &&
    other.source === "codex" &&
    time - other.updatedAt < c.timing.idleMs &&
    (e.status === "idle" || ["working", "thinking"].includes(other.status))
      ? other
      : next;
  const current = readJSON("state.json");
  if (!(current.eventTime > selected.eventTime)) writeJSON("state.json", selected);
  return next;
}
export async function main() {
  let data = process.argv[2];
  if (!data) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1024 * 1024) throw Error("Hook input exceeds 1 MiB");
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    data = Buffer.concat(chunks).toString();
  }
  if (Buffer.byteLength(data || "") > 1024 * 1024)
    throw Error("Hook input exceeds 1 MiB");
  for (const line of (data || "").split("\n").filter(Boolean))
    applyEvent(JSON.parse(line));
}
if (isMain(import.meta.url))
  main().catch((e) => {
    console.error(`codex-rpc hook: ${e.message}`);
    process.exitCode = 1;
  });

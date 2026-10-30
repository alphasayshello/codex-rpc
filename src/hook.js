import { toolTelemetry } from "./watcher.js";
import { workspaceBranch } from "./workspace.js";
import path from "node:path";
import { taskTitle } from "./presence.js";
import { conversationName } from "./threads.js";
import { isMain, readJSON, writeJSON, config } from "./store.js";
import { liveSessionFile, readLiveSession, normalizeUsage } from "./live.js";
import { recapCounters, recordTurnEvent } from "./recaps.js";
import { nativeEvent, isNativeEvent } from "./native-events.js";
import { dispatchEvent, drainEvents } from "./event-queue.js";
const safeText = (value, max = 256) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max) : undefined;
const counter = (value) => ["number", "string"].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
const toolStarts = new Set(["tool-start", "function_call", "custom_tool_call"]);
const toolEnds = new Set(["tool-end", "function_call_output", "custom_tool_call_output"]);
function toolMetadata(event, settings) {
  const metadata = {};
  for (const field of ["file", "safeFiles", "fileCount", "linesAdded", "linesRemoved", "commandSummary", "operationKind", "effectiveTool"])
    if (event[field] !== undefined && (settings.privacy === "public" || ["fileCount", "linesAdded", "linesRemoved", "operationKind", "effectiveTool"].includes(field))) metadata[field] = event[field];
  if (event.safeFiles?.length) metadata.fileCount = event.safeFiles.length;
  return metadata;
}
function persistSameChat(next, prior, source, sessionId) {
  if (sessionId) writeJSON(liveSessionFile(sessionId, source), next);
  for (const name of [`${source}-state.json`, "state.json"]) {
    const selected = readJSON(name);
    if (selected.sessionId === sessionId && (selected.source || "codex") === source && selected.eventTime === prior.eventTime)
      writeJSON(name, next);
  }
}
function redactSnapshot(next, settings) {
  if (settings.privacy !== "public" || !settings.presence.showTask) delete next.task;
  if (settings.privacy !== "public") {
    for (const key of ["project", "branch", "file", "currentFiles", "commandSummary"]) delete next[key];
    const redactTool = ({ file, safeFiles, commandSummary, ...tool }) => tool;
    next.activeTools = (next.activeTools || []).map(redactTool);
    next.recentTools = (next.recentTools || []).map(redactTool);
    if (next.lastTool) next.lastTool = redactTool(next.lastTool);
  }
  return next;
}
function mergeStaleTool(event, prior, source, sessionId, at, settings) {
  const id = String(event.callId), metadata = toolMetadata(event, settings);
  let active = [...(prior.activeTools || [])], recent = [...(prior.recentTools || [])];
  const seen = [...(prior.toolCallIds || [])];
  const known = recent.find((tool) => tool.callId === id);
  if (toolStarts.has(event.type)) {
    if (!seen.includes(id)) {
      seen.push(id);
      const open = !prior.turnClosedAt && !(prior.closedTurnIds || []).includes(event.turnId) && ["working", "thinking"].includes(prior.status)
        && (!event.turnId || !prior.turnId || event.turnId === prior.turnId)
        && (!prior.turnStartedAt || at >= prior.turnStartedAt);
      const tool = { name: event.tool || "tool", callId: id, startedAt: at, status: open ? "running" : "unknown", ...metadata,
        ...(!open ? { endedAt: Math.max(at, prior.turnClosedAt || prior.eventTime), durationMs: Math.max(0, (prior.turnClosedAt || prior.eventTime) - at) } : {}) };
      if (open) active.push(tool);
      recent = [...recent, tool].slice(-50);
    } else {
      // Fill missing metadata without replacing a newer observation of this ID.
      active = active.map((tool) => tool.callId === id ? { ...metadata, ...tool } : tool);
      recent = recent.map((tool) => tool.callId === id ? { ...metadata, ...tool } : tool);
    }
  } else {
    const running = active.find((tool) => tool.callId === id);
    if (running || !seen.includes(id) || known?.status === "unknown" || (event.outcome?.status === "failed" && known?.status !== "failed")) {
      if (!seen.includes(id)) seen.push(id);
      const ended = { ...(running || known || { name: event.tool || "tool", callId: id }), ...metadata, ...event.outcome,
        endedAt: at, ...(Number.isFinite((running || known)?.startedAt) ? { durationMs: Math.max(0, at - (running || known).startedAt) } : {}) };
      recent = [...recent.filter((tool) => tool.callId !== id), ended].slice(-50);
      active = active.filter((tool) => tool.callId !== id);
    }
  }
  active.sort((a, b) => a.startedAt - b.startedAt);
  const next = { ...prior, activeTools: active, recentTools: recent, toolCallIds: seen, observedToolCalls: seen.length };
  if (prior.lastTool?.callId === id) next.lastTool = recent.find((tool) => tool.callId === id) || prior.lastTool;
  if (prior.status === "working" && active.length) {
    const files = [...new Set([...active].reverse().flatMap((tool) => tool.safeFiles || (tool.file ? [tool.file] : [])))];
    if (files.length) { next.currentFiles = files; next.currentFileCount = files.length; next.file = files[0]; }
    else {
      const counts = active.map((tool) => tool.fileCount).filter((count) => count > 0);
      if (counts.length) next.currentFileCount = counts.length === 1 ? counts[0] : null;
    }
    for (const key of ["linesAdded", "linesRemoved"]) {
      const values = active.map((tool) => tool[key]).filter((value) => typeof value === "number");
      if (values.length) next[key] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  recordTurnEvent(event, prior, next, at, settings);
  redactSnapshot(next, settings);
  persistSameChat(next, prior, source, sessionId);
  return next;
}
const states = {
  working: "working",
  writing: "working",
  coding: "working",
  patching: "working",
  diff_applying: "working",
  planning: "thinking",
  sleeping: "idle",
  stuck: "waiting",
  done: "waiting",
  success: "waiting",
  thinking: "thinking",
  waiting: "waiting",
  idle: "idle",
  "session-start": "waiting",
  "turn-start": "thinking",
  task_started: "thinking",
  user_message: "thinking",
  token_count: "thinking",
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
  const failed = objects.some((v) => v.is_error === true || v.isError === true || ["failed", "error", "cancelled", "canceled"].includes(v.status)
    || (input.nativeHook && (v.success === false || (typeof v.error === "string" && v.error.length > 0)))) || (exitCode != null && exitCode !== 0);
  const confirmed = exitCode === 0 || objects.some((v) => v.success === true || v.is_error === false || v.isError === false || ["completed", "success", "succeeded"].includes(v.status));
  return { status: failed ? "failed" : input.nativeHook && !confirmed ? "unknown" : "completed", ...(exitCode != null ? { exitCode } : {}) };
}
export function normalizeEvent(input) {
  if (!input || typeof input !== "object") return null;
  if (isNativeEvent(input)) input = nativeEvent(input);
  if (!input) return null;
  const p = input.payload || input;
  const rawType = p.type || input.type;
  const type = typeof rawType === "string" ? rawType.toLowerCase() : "";
  let status = Object.hasOwn(states, type) ? states[type] : undefined;
  if (
    type === "reasoning" ||
    (p.role === "assistant" && p.content?.some?.((x) => x.type === "reasoning"))
  )
    status = "thinking";
  if (p.role === "user") status = "thinking";
  if (!status) return null;
  const telemetry = toolTelemetry(input);
  const visuals = { writing: "writing", coding: "writing", patching: "patching", diff_applying: "patching", planning: "thinking", sleeping: "idle", stuck: "error", error: "error", done: "done", success: "done" };
  const cwd = input.cwd || p.cwd;
  const rawTimestamp = input.timestamp;
  const parsedTimestamp = typeof rawTimestamp === "number" ? rawTimestamp : Date.parse(rawTimestamp);
  return {
    status,
    type,
    nativeHook: input.nativeHook === true,
    ...telemetry,
    visualState: Object.hasOwn(visuals, type) ? visuals[type] : undefined,
    branch: cwd ? workspaceBranch(cwd) || undefined : undefined,
    workspaceObserved: !!cwd,
    tokenOnly: input.tokenOnly === true || type === "token_count",
    turnId: typeof (input.turnId || input.turn_id || p.turn_id || p.turn?.id) === "string" ? (input.turnId || input.turn_id || p.turn_id || p.turn?.id).slice(0, 256) : undefined,
    recapUsage: recapCounters(input.usage || p.thread_token_usage || p.info?.total_token_usage),
    recapChanges: {
      linesAdded: Number.isSafeInteger(input.linesAdded ?? p.lines_added) && (input.linesAdded ?? p.lines_added) >= 0 ? input.linesAdded ?? p.lines_added : null,
      linesRemoved: Number.isSafeInteger(input.linesRemoved ?? p.lines_removed) && (input.linesRemoved ?? p.lines_removed) >= 0 ? input.linesRemoved ?? p.lines_removed : null,
    },
    callId: safeText(p.call_id || input.callId || input.call_id || p.id),
    usage: normalizeUsage(input.usage || p.thread_token_usage || p.info?.total_token_usage),
    lastUsage: normalizeUsage(input.lastUsage || p.info?.last_token_usage),
    contextWindow: counter(input.contextWindow ?? p.info?.model_context_window ?? p.model_context_window),
    source: input.source === "chatgpt" || p.source === "chatgpt" ? "chatgpt" : "codex",
    sessionId: safeText(input["thread-id"] || input.thread_id || p.session_id || input.sessionId || p.thread_id),
    project:
      safeText(input.project || (typeof cwd === "string" ? path.basename(cwd) : undefined), 128),
    task: taskTitle(input.threadName || input.task || p.thread_name),
    waitingReason: ["error", "task_failed", "stuck"].includes(type)
      ? "error"
      : type === "approval-request"
        ? "approval"
        : ["done", "approval", "error", "ready"].includes(input.waitingReason)
          ? input.waitingReason
          : ["agent-turn-complete", "task_complete", "waiting", "done", "success"].includes(type)
            ? "done"
            : undefined,
    model: safeText(input.model || p.model, 128),
    tool: safeText(input.tool || p.name, 128),
    tokens: counter(input.tokens ?? p.info?.total_token_usage?.total_tokens),
    timestamp: new Date(Number.isFinite(parsedTimestamp) && parsedTimestamp >= 0 && parsedTimestamp <= 8640000000000000 ? parsedTimestamp : Date.now()).toISOString(),
    outcome: ["tool-end", "function_call_output", "custom_tool_call_output"].includes(type) ? toolOutcome(input) : undefined,
  };
}
export function applyEvent(input) {
  const e = normalizeEvent(input);
  if (!e) return null;
  const c = config();
  if (!c.enabled) return null;
  if (e.safeFiles?.length) e.fileCount = e.safeFiles.length;
  if (c.privacy !== "public") {
    for (const key of ["project", "branch", "task", "file", "safeFiles", "commandSummary"]) delete e[key];
  } else if (!c.presence.showTask) delete e.task;
  return dispatchEvent(e, applyNormalizedEvent);
}
export function drainHookEvents() { return drainEvents(applyNormalizedEvent); }
export function applyNormalizedEvent(e) {
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
  const time = Date.now();
  const parsedTime = typeof e.timestamp === "number" ? e.timestamp : Date.parse(e.timestamp);
  const eventTime = Number.isFinite(parsedTime) && parsedTime >= 0 ? parsedTime : time;
  const closedIdentity = e.turnId && (prior.closedTurnIds || []).includes(e.turnId);
  if ((closedIdentity || (prior.turnClosedAt && (!e.turnId || !prior.turnId || e.turnId === prior.turnId)))
    && !e.tokenOnly && e.sessionId && e.callId && (toolStarts.has(e.type) || toolEnds.has(e.type)))
    return mergeStaleTool(e, prior, source, sessionId, eventTime, c);
  if (closedIdentity && e.turnId !== prior.turnId && ["task_complete", "agent-turn-complete", "turn_aborted", "session-end", "task_failed", "error"].includes(e.type)) {
    recordTurnEvent(e, prior, prior, eventTime, c);
    return prior;
  }
  if (prior.eventTime > eventTime) {
    if (!e.tokenOnly && e.sessionId && e.callId && (toolStarts.has(e.type) || toolEnds.has(e.type)))
      return mergeStaleTool(e, prior, source, sessionId, eventTime, c);
    // Native hooks arrive without producer timestamps. A later-tailed log may
    // still carry newer cumulative usage, but must not replay old lifecycle or
    // steal selection. Accept only monotonic counters for this exact chat.
    const before = prior.usage || {}, usage = e.usage;
    const recapOnly = e.tokenOnly && e.sessionId && usage && e.turnId;
    // A late final record for turn A may be lower than turn B's live total.
    // Reconcile only its explicit identity using observed producer counters,
    // never merged newer counters from the selected live snapshot.
    if (recapOnly) recordTurnEvent(e, prior, prior, eventTime, c);
    const fresh = e.tokenOnly && e.sessionId && usage &&
      usage.total >= (prior.tokens || before.total || 0) &&
      usage.input >= (before.input || 0) && usage.output >= (before.output || 0) &&
      (usage.total > (prior.tokens || before.total || 0) || usage.input > (before.input || 0) || usage.output > (before.output || 0));
    if (!fresh) return prior;
    const next = { ...prior, usage: { ...usage, cached: Math.max(usage.cached, before.cached || 0), reasoning: Math.max(usage.reasoning, before.reasoning || 0) }, tokens: usage.total };
    if (!recapOnly) recordTurnEvent(e, prior, next, eventTime, c);
    redactSnapshot(next, c);
    if (sessionId) writeJSON(liveSessionFile(sessionId, source), next);
    const updateSameChat = (name) => {
      const selected = readJSON(name);
      if (selected.sessionId === sessionId && (selected.source || "codex") === source && selected.eventTime === prior.eventTime)
        writeJSON(name, redactSnapshot({ ...selected, usage: next.usage, tokens: next.tokens }, c));
    };
    updateSameChat(`${source}-state.json`);
    updateSameChat("state.json");
    return next;
  }
  const next = {
    ...prior,
    status: e.tokenOnly && e.type !== "token_count" ? prior.status || e.status : e.status,
    source,
    updatedAt: time,
    eventTime,
    startedAt:
      prior.startedAt == null || (e.sessionId && e.sessionId !== prior.sessionId)
        ? eventTime
        : prior.startedAt,
  };
  for (const k of [
    "sessionId",
    "project",
    "branch",
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
  if (["turn-start", "task_started", "user_message"].includes(e.type) && !e.tokenOnly) {
    next.turnStartedAt = eventTime;
    if (e.turnId) next.turnId = e.turnId;
    else delete next.turnId;
    delete next.turnClosedAt;
  } else if ((toolStarts.has(e.type) || toolEnds.has(e.type)) && e.turnId && e.turnId !== prior.turnId) {
    next.turnId = e.turnId;
    delete next.turnStartedAt;
    delete next.turnClosedAt;
  }
  if (e.type === "session-start") delete next.turnClosedAt;
  if (["task_complete", "agent-turn-complete", "turn_aborted", "session-end", "task_failed", "error"].includes(e.type) && !e.tokenOnly) {
    next.turnClosedAt = eventTime;
    const closed = e.turnId || prior.turnId;
    if (closed) next.closedTurnIds = [...new Set([...(prior.closedTurnIds || []), closed])].slice(-20);
  }
  if (e.sessionId && e.sessionId !== prior.sessionId && !e.task) {
    delete next.task;
    delete next.taskSource;
  }
  if (!e.task && !prior.taskSource) delete next.task;
  if (e.workspaceObserved && !e.branch) delete next.branch;
  if (e.usage) {
    next.usage = e.usage;
    next.tokens = e.usage.total;
  } else if (e.tokens !== undefined) {
    next.tokens = Math.max(0, Number(e.tokens) || 0);
    if (next.usage) next.usage = { ...next.usage, total: next.tokens };
  }
  const metadata = toolMetadata(e, c);
  const starts = toolStarts.has(e.type);
  const ends = toolEnds.has(e.type);
  let active = [...(prior.activeTools || [])];
  let recent = [...(prior.recentTools || [])];
  const seen = [...(prior.toolCallIds || [])];
  if (starts && !e.tokenOnly) {
    const callId = String(e.callId || `${e.tool || "tool"}:${eventTime}`);
    if (!seen.includes(callId)) {
      seen.push(callId);
      const tool = { name: String(e.tool || "tool").slice(0, 128), callId, status: "running", startedAt: eventTime, ...metadata };
      active.push(tool);
      recent = [...recent.filter((t) => t.callId !== callId), tool].slice(-50);
      next.lastTool = tool;
    } else if (active.some((t) => t.callId === callId)) {
      // Repeated notifications report cumulative metadata for this invocation;
      // replace its observation rather than counting the same diff twice.
      active = active.map((tool) => tool.callId === callId ? { ...tool, ...metadata } : tool);
      recent = recent.map((tool) => tool.callId === callId ? { ...tool, ...metadata } : tool);
      next.lastTool = active.find((tool) => tool.callId === callId);
    } else {
      // Replayed completed calls cannot revive an old working state.
      next.status = prior.status || "thinking";
      next.tool = prior.tool;
    }
  } else if (ends && !e.tokenOnly) {
    const target = e.callId ? String(e.callId) : active.at(-1)?.callId;
    const tool = active.find((t) => t.callId === target);
    if (tool) {
      const completed = { ...tool, ...metadata, ...e.outcome, endedAt: eventTime, durationMs: Math.max(0, eventTime - tool.startedAt) };
      recent = [...recent.filter((t) => t.callId !== target), completed].slice(-50);
      next.lastTool = completed;
      active = active.filter((t) => t.callId !== target);
    } else if (e.nativeHook && target && !seen.includes(target)) {
      // Async callback scheduling can deliver PostToolUse first. Remember its
      // stable ID so a delayed native/log PreToolUse cannot revive the call.
      seen.push(target);
      const completed = { name: String(e.tool || "tool").slice(0, 128), callId: target, ...metadata, ...e.outcome, endedAt: eventTime };
      recent = [...recent.filter((t) => t.callId !== target), completed].slice(-50);
      next.lastTool = completed;
    } else if (e.nativeHook && target) {
      const existing = recent.find((entry) => entry.callId === target);
      if (existing && ((existing.status === "unknown" && e.outcome?.status !== "unknown") || (existing.status !== "failed" && e.outcome?.status === "failed"))) {
        // Permission waits can temporarily close active calls as unknown. A
        // later explicit native result refines the outcome without a new call.
        const completed = { ...existing, ...metadata, ...e.outcome, endedAt: eventTime,
          ...(Number.isFinite(existing.startedAt) ? { durationMs: Math.max(0, eventTime - existing.startedAt) } : {}) };
        recent = recent.map((entry) => entry.callId === target ? completed : entry);
        next.lastTool = completed;
      }
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
  }
  // Current operation metadata comes from live calls, not completed/lifetime
  // totals. Parallel calls retain independent files and cumulative diff counts.
  for (const field of ["file", "currentFiles", "currentFileCount", "linesAdded", "linesRemoved", "commandSummary", "operationKind", "effectiveTool"]) delete next[field];
  if (next.status === "working") {
    const operation = e.tokenOnly ? { file: prior.file, safeFiles: prior.currentFiles, fileCount: prior.currentFileCount,
      linesAdded: prior.linesAdded, linesRemoved: prior.linesRemoved, commandSummary: prior.commandSummary, operationKind: prior.operationKind, effectiveTool: prior.effectiveTool } : metadata;
    const operations = active.length ? active : !ends ? [operation] : [];
    const files = [...new Set([...operations].reverse().flatMap((tool) => tool.safeFiles || (tool.file ? [tool.file] : [])))];
    if (files.length) { next.currentFiles = files; next.currentFileCount = files.length; next.file = files[0]; }
    else {
      const fileOperations = operations.filter((tool) => tool.fileCount > 0);
      if (fileOperations.length === 1) next.currentFileCount = fileOperations[0].fileCount;
      else if (fileOperations.length > 1) next.currentFileCount = null;
    }
    for (const field of ["linesAdded", "linesRemoved"]) {
      const values = operations.map((tool) => tool[field]).filter((value) => typeof value === "number");
      if (values.length) next[field] = values.reduce((sum, value) => sum + value, 0);
    }
    for (const field of ["operationKind", "effectiveTool"])
      if (operations.at(-1)?.[field]) next[field] = operations.at(-1)[field];
    const command = operations.at(-1)?.commandSummary;
    if (command) next.commandSummary = command;
  } else delete next.tool;
  const previousCall = prior.activeTools?.at(-1)?.callId;
  const currentCall = active.at(-1)?.callId;
  if (!Number.isFinite(prior.operationStartedAt) || prior.status !== next.status || (!e.tokenOnly && previousCall !== currentCall))
    next.operationStartedAt = active.at(-1)?.startedAt ?? eventTime;
  if (next.status === "thinking") {
    if (!Number.isFinite(prior.thinkingStartedAt) || prior.status !== "thinking") next.thinkingStartedAt = eventTime;
  } else delete next.thinkingStartedAt;
  if (!e.tokenOnly) {
    if (e.visualState) next.visualState = e.visualState;
    else delete next.visualState;
  }
  if (ends && e.outcome?.status === "failed") next.visualState = "error";
  if (!e.tokenOnly && next.status !== "waiting") delete next.waitingReason;
  if (c.privacy === "private" || !c.presence.showTask) delete next.task;
  if (c.privacy === "private") {
    delete next.project;
    delete next.branch;
    delete next.file;
    delete next.currentFiles;
    delete next.commandSummary;
    delete next.task;
    const privateTool = ({ file, safeFiles, commandSummary, ...tool }) => tool;
    next.activeTools = next.activeTools.map(privateTool);
    next.recentTools = next.recentTools.map(privateTool);
    if (next.lastTool) next.lastTool = privateTool(next.lastTool);
  }
  recordTurnEvent(e, prior, next, eventTime, c);
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
export async function main(data = process.argv[2]) {
  const nativeFailure = (input) => {
    if (!/"hook_event_name"\s*:\s*"/.test(input || "")) return false;
    if (/"hook_event_name"\s*:\s*"Stop"/.test(input)) process.stdout.write("{}");
    return true;
  };
  if (!data) {
    const chunks = [];
    let size = 0, oversized = false, hints = "", tail = "";
    try {
      for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const scan = tail + buffer.toString();
        const found = scan.match(/"hook_event_name"\s*:\s*"[^"\r\n]{0,128}"/g);
        if (found) {
          if (found.some((value) => /:\s*"Stop"$/.test(value))) hints = '"hook_event_name":"Stop"';
          else hints ||= found[0];
        }
        tail = scan.slice(-256);
        size += buffer.length;
        if (size > 1024 * 1024) oversized = true;
        else chunks.push(buffer);
      }
    } catch (error) {
      if (nativeFailure(hints || Buffer.concat(chunks).toString())) return;
      throw error;
    }
    if (oversized) {
      if (nativeFailure(hints)) return;
      throw Error("Hook input exceeds 1 MiB");
    }
    data = Buffer.concat(chunks).toString();
  }
  if (Buffer.byteLength(data || "") > 1024 * 1024) {
    if (nativeFailure(data)) return;
    throw Error("Hook input exceeds 1 MiB");
  }
  let inputs;
  try {
    // Native stdin is often pretty JSON; legacy notify still supports JSONL.
    try { inputs = [JSON.parse(data)]; }
    catch { inputs = (data || "").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)); }
  } catch (error) {
    if (nativeFailure(data)) return;
    throw error;
  }
  let stop = false;
  for (const input of inputs) {
    const native = isNativeEvent(input);
    try { applyEvent(input); }
    catch (error) { if (!native) throw error; }
    if (native && input.hook_event_name === "Stop") stop = true;
  }
  if (stop) process.stdout.write("{}");
}
if (isMain(import.meta.url))
  main().catch((e) => {
    console.error(`codex-rpc hook: ${e.message}`);
    process.exitCode = 1;
  });

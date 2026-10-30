import { config, readJSON, writeJSON } from "./store.js";
import { liveSessionFile } from "./live.js";
import { safeFilePath } from "./paths.js";
import { createHash } from "node:crypto";

export const recapFile = (id, source = "codex") => liveSessionFile(id, source).replace(/^live\//, "recaps/");
const count = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
const starts = new Set(["task_started", "turn-start", "user_message"]);
const toolStarts = new Set(["tool-start", "function_call", "custom_tool_call"]);
const toolEnds = new Set(["tool-end", "function_call_output", "custom_tool_call_output"]);
const outcomes = { task_complete: "completed", "agent-turn-complete": "completed", turn_aborted: "aborted", task_failed: "failed", error: "failed" };
export function recapCounters(value) {
  if (!value || typeof value !== "object") return {};
  const output = count(value.output ?? value.output_tokens);
  const reasoning = count(value.reasoning ?? value.reasoning_output_tokens ?? value.output_tokens_details?.reasoning_tokens);
  return { ...(output != null ? { output } : {}), ...(reasoning != null ? { reasoning } : {}) };
}
function observeUsage(target, counters, at) {
  target.counters ||= {};
  target.counterAt ||= {};
  target.observed ||= {};
  target.reset ||= {};
  for (const key of ["output", "reasoning"]) {
    if (counters[key] == null || at < (target.counterAt[key] ?? -Infinity)) continue;
    if (target.counters[key] != null && counters[key] < target.counters[key]) target.reset[key] = true;
    target.counters[key] = counters[key];
    target.counterAt[key] = at;
    target.observed[key] = true;
  }
}
function usageTotals(target) {
  const delta = (key) => !target.reset?.[key] && target.observed?.[key] && target.baseline?.[key] != null && target.counters?.[key] != null
    ? Math.max(0, target.counters[key] - target.baseline[key]) : null;
  const outputTokens = delta("output"), reasoning = delta("reasoning");
  return { outputTokens, reasoningTokens: reasoning != null && outputTokens != null ? Math.min(reasoning, outputTokens) : reasoning };
}
function redact(data, settings) {
  if (settings.privacy === "public") return;
  for (const turn of data.turns) turn.files = null;
  if (data.active) for (const hash of Object.keys(data.active.files || {})) data.active.files[hash] = null;
}
function toolMetadata(active, event, prior, next, settings) {
  if (!toolStarts.has(event.type) && !toolEnds.has(event.type)) return;
  const callId = String(event.callId || (toolEnds.has(event.type) ? prior.activeTools?.at(-1)?.callId : next.lastTool?.callId) || "");
  if (!callId) return;
  active.calls ||= {};
  if (!Object.hasOwn(active.calls, callId) && Object.keys(active.calls).length >= 256) { active.metricsOverflow = true; return; }
  const call = Object.hasOwn(active.calls, callId) ? active.calls[callId] : {};
  // Store observations per invocation. Native hooks and JSONL events report
  // the same call, so repeated cumulative counts replace rather than add.
  for (const key of ["linesAdded", "linesRemoved"]) {
    const value = count(event.recapChanges?.[key] ?? event[key]);
    if (value != null) call[key] = value;
  }
  if (toolEnds.has(event.type) && event.outcome?.status === "failed") call.status = "failed";
  else if (toolEnds.has(event.type) && call.status !== "failed") call.status = event.outcome?.status === "completed" ? "completed" : "unknown";
  else call.status ||= "running";
  // Null-prototype JSON maps are not required: define an own property even for
  // a tool ID such as __proto__, rather than invoking Object.prototype setters.
  Object.defineProperty(active.calls, callId, { value: call, writable: true, enumerable: true, configurable: true });
  const paths = [...(Array.isArray(event.safeFiles) ? event.safeFiles : []), event.file].map(safeFilePath).filter(Boolean);
  for (const filename of new Set(paths)) {
    const hash = createHash("sha256").update(filename).digest("hex");
    if (Object.hasOwn(active.files, hash) || Object.keys(active.files).length < 100)
      active.files[hash] = settings.privacy === "public" ? filename : null;
    else active.filesOverflow = true;
  }
}
function recordedLines(active, key) {
  if (active.metricsOverflow) return null;
  const calls = Object.values(active.calls || {});
  // An unfinished edit cannot honestly be called applied. Failed calls do not
  // contribute their proposed changes; successful counts remain observations,
  // not a claim that filesystem contents were independently verified.
  if (calls.some((call) => count(call[key]) != null && !["completed", "failed"].includes(call.status))) return null;
  const values = calls.filter((call) => call.status === "completed").map((call) => count(call[key])).filter((value) => value != null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
function reconcileClosedTurn(data, event, counters, at) {
  if (!event.tokenOnly || !event.turnId || !Object.keys(counters).length) return false;
  const turn = data.turns.find((row) => row.turnId === event.turnId);
  if (!turn?._usage || at < turn.startedAt) return false;
  observeUsage(turn._usage, counters, at);
  Object.assign(turn, usageTotals(turn._usage));
  // A final sample delayed past the next start can refine that next turn's
  // baseline, only when its PRODUCER timestamp proves it predates that start.
  // Never feed an old turn's output into a newer turn's observed counters.
  const following = [...data.turns.filter((row) => row !== turn && row._usage).map((row) => ({ row, usage: row._usage, startedAt: row.startedAt })),
    ...(data.active ? [{ usage: data.active, startedAt: data.active.startedAt }] : [])];
  for (const entry of following) for (const key of ["output", "reasoning"]) {
    if (counters[key] == null || at >= entry.startedAt || at <= (entry.usage.baselineAt?.[key] ?? -Infinity)) continue;
    if (entry.usage.baseline?.[key] == null) continue; // Missing baselines stay unknown.
    if (counters[key] < entry.usage.baseline[key]) entry.usage.reset[key] = true;
    entry.usage.baseline[key] = counters[key];
    entry.usage.baselineAt ||= {};
    entry.usage.baselineAt[key] = at;
    if (entry.row) Object.assign(entry.row, usageTotals(entry.usage));
  }
  for (const key of ["output", "reasoning"]) if (counters[key] != null && at >= (data.counterAt[key] ?? -Infinity)) {
    data.counters[key] = counters[key]; data.counterAt[key] = at;
  }
  return true;
}
// Called with normalized metadata only. Raw hook payloads never enter disk.
export function recordTurnEvent(event, prior, next, at, settings) {
  if (!next.sessionId) return;
  const filename = recapFile(next.sessionId, next.source);
  const saved = readJSON(filename);
  const data = saved.sessionId === next.sessionId && saved.source === next.source
    ? saved : { schemaVersion: 1, sessionId: next.sessionId, source: next.source, counters: {}, turns: [] };
  data.counters ||= {}; data.counterAt ||= {}; data.turns ||= [];
  const counters = event.recapUsage || {};
  if (reconcileClosedTurn(data, event, counters, at)) {
    redact(data, settings); writeJSON(filename, data); return;
  }
  let active = data.active;
  if (active?.turnId && event.turnId && event.turnId !== active.turnId && !starts.has(event.type)) return;
  if (active) {
    // Migrate an in-progress turn from versions that kept counters only at the
    // conversation level; retain reset detection rather than fabricating zero.
    active.counters ||= { ...data.counters };
    active.counterAt ||= { ...data.counterAt };
    if (["working", "thinking"].includes(prior.status)) active.activeDurationMs += Math.min(Math.max(0, at - active.lastAt), settings.timing?.idleMs ?? 300000);
    active.lastAt = Math.max(active.lastAt, at);
    observeUsage(active, counters, at);
  }
  for (const key of ["output", "reasoning"]) if (counters[key] != null && at >= (data.counterAt[key] ?? -Infinity)) {
    data.counters[key] = counters[key]; data.counterAt[key] = at;
  }
  if (starts.has(event.type) && !event.tokenOnly) {
    const turnId = event.turnId || null;
    if (!active || (turnId && active.turnId && turnId !== active.turnId)) {
      const id = `${next.sessionId}:${turnId || at}`;
      if (data.turns.some((turn) => turn.id === id)) return;
      active = { id, turnId, startedAt: at, lastAt: at, activeDurationMs: 0,
        baseline: { output: data.counters.output ?? null, reasoning: data.counters.reasoning ?? null }, baselineAt: { ...data.counterAt },
        counters: { ...data.counters }, counterAt: { ...data.counterAt }, observed: {}, reset: {},
        toolBaseline: prior.observedToolCalls || 0, calls: {}, files: {}, filesOverflow: false };
      data.active = active;
    } else if (!active.turnId && turnId) {
      active.turnId = turnId; active.id = `${next.sessionId}:${turnId}`;
    }
  }
  if (active) {
    active.model = next.model || active.model || null;
    toolMetadata(active, event, prior, next, settings);
    const outcome = Object.hasOwn(outcomes, event.type) ? outcomes[event.type] : undefined;
    if (outcome && !event.tokenOnly && (!event.turnId || !active.turnId || event.turnId === active.turnId)) {
      const paths = Object.values(active.files).filter(Boolean);
      const summary = {
        id: active.id, sessionId: next.sessionId, turnId: active.turnId, source: next.source, model: active.model,
        startedAt: active.startedAt, endedAt: at, outcome, ...usageTotals(active),
        toolCalls: active.metricsOverflow ? null : Object.keys(active.calls || {}).length, activeDurationMs: active.activeDurationMs,
        elapsedMs: Math.max(0, at - active.startedAt), linesAdded: recordedLines(active, "linesAdded"), linesRemoved: recordedLines(active, "linesRemoved"),
        filesTouched: active.filesOverflow ? null : Object.keys(active.files).length || null,
        files: settings.privacy === "public" && paths.length ? paths : null,
        _usage: { baseline: active.baseline, baselineAt: active.baselineAt, counters: active.counters, counterAt: active.counterAt, observed: active.observed, reset: active.reset },
      };
      data.turns = [summary, ...data.turns.filter((turn) => turn.id !== summary.id)].slice(0, 20);
      delete data.active;
    }
  }
  redact(data, settings);
  if (active || Object.keys(counters).length || saved.sessionId) writeJSON(filename, data);
}
export function getTurnRecaps(state, settings = config()) {
  if (!state?.sessionId) return [];
  const source = state.source || "codex", data = readJSON(recapFile(state.sessionId, source));
  if (data.sessionId !== state.sessionId || data.source !== source) return [];
  return (data.turns || []).slice(0, 20).map((turn) => ({
    id: turn.id, sessionId: state.sessionId, turnId: turn.turnId || null, source,
    model: turn.model || null, startedAt: turn.startedAt, endedAt: turn.endedAt, outcome: turn.outcome,
    outputTokens: count(turn.outputTokens), reasoningTokens: count(turn.reasoningTokens), toolCalls: count(turn.toolCalls),
    activeDurationMs: count(turn.activeDurationMs), elapsedMs: count(turn.elapsedMs), linesAdded: count(turn.linesAdded), linesRemoved: count(turn.linesRemoved), filesTouched: count(turn.filesTouched),
    files: settings.privacy === "public" && Array.isArray(turn.files) ? turn.files.map(safeFilePath).filter(Boolean) : null,
  }));
}

import { config, readJSON, writeJSON } from "./store.js";
import { liveSessionFile } from "./live.js";
import { safeFilePath } from "./paths.js";
import { createHash } from "node:crypto";

export const recapFile = (id, source = "codex") => liveSessionFile(id, source).replace(/^live\//, "recaps/");
const count = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
const starts = new Set(["task_started", "turn-start", "user_message"]);
const outcomes = { task_complete: "completed", "agent-turn-complete": "completed", turn_aborted: "aborted", task_failed: "failed", error: "failed" };
export function recapCounters(value) {
  if (!value || typeof value !== "object") return {};
  const output = count(value.output ?? value.output_tokens);
  const reasoning = count(value.reasoning ?? value.reasoning_output_tokens ?? value.output_tokens_details?.reasoning_tokens);
  return { ...(output != null ? { output } : {}), ...(reasoning != null ? { reasoning } : {}) };
}
// Called with normalized, metadata-only events. No raw hook payload enters disk.
export function recordTurnEvent(event, prior, next, at, settings) {
  if (!next.sessionId) return;
  const filename = recapFile(next.sessionId, next.source);
  const saved = readJSON(filename);
  const data = saved.sessionId === next.sessionId && saved.source === next.source
    ? saved : { schemaVersion: 1, sessionId: next.sessionId, source: next.source, counters: {}, turns: [] };
  data.counters ||= {};
  data.turns ||= [];
  let active = data.active;
  if (active?.turnId && event.turnId && event.turnId !== active.turnId && !starts.has(event.type)) return;
  const counters = event.recapUsage || {};
  if (active) {
    if (["working", "thinking"].includes(prior.status)) active.activeDurationMs += Math.min(Math.max(0, at - active.lastAt), settings.timing?.idleMs ?? 300000);
    active.lastAt = Math.max(active.lastAt, at);
    for (const key of ["output", "reasoning"]) {
      if (counters[key] != null) {
        if (data.counters[key] != null && counters[key] < data.counters[key]) active.reset[key] = true;
        active.observed[key] = true;
      }
    }
  }
  Object.assign(data.counters, counters);
  if (starts.has(event.type) && !event.tokenOnly) {
    const turnId = event.turnId || null;
    if (!active || (turnId && active.turnId && turnId !== active.turnId)) {
      const id = `${next.sessionId}:${turnId || at}`;
      if (data.turns.some((turn) => turn.id === id)) return;
      active = { id, turnId, startedAt: at, lastAt: at, activeDurationMs: 0,
        baseline: { output: data.counters.output ?? null, reasoning: data.counters.reasoning ?? null },
        observed: {}, reset: {}, toolBaseline: prior.observedToolCalls || 0,
        linesAdded: null, linesRemoved: null, files: {}, filesOverflow: false };
      data.active = active;
    } else if (!active.turnId && turnId) {
      active.turnId = turnId;
      active.id = `${next.sessionId}:${turnId}`;
    }
  }
  if (active) {
    active.model = next.model || active.model || null;
    // A recorded file is a tool touch, never inferred from command text.
    const newCall = (next.observedToolCalls || 0) > (prior.observedToolCalls || 0);
    if (newCall && event.file) {
      const hash = createHash("sha256").update(event.file).digest("hex");
      if (Object.hasOwn(active.files, hash) || Object.keys(active.files).length < 100)
        active.files[hash] = settings.privacy === "public" ? event.file : null;
      else active.filesOverflow = true;
    }
    const completedCall = ["tool-end", "function_call_output", "custom_tool_call_output"].includes(event.type)
      && prior.activeTools?.some((tool) => event.callId ? tool.callId === String(event.callId) : tool.callId === prior.activeTools.at(-1)?.callId);
    if (newCall || completedCall) for (const key of ["linesAdded", "linesRemoved"])
      if (event.recapChanges?.[key] != null) active[key] = (active[key] || 0) + event.recapChanges[key];
    const outcome = outcomes[event.type];
    if (outcome && !event.tokenOnly && (!event.turnId || !active.turnId || event.turnId === active.turnId)) {
      const delta = (key) => !active.reset[key] && active.observed[key] && active.baseline[key] != null && data.counters[key] != null
        ? Math.max(0, data.counters[key] - active.baseline[key]) : null;
      const outputTokens = delta("output"), reasoning = delta("reasoning");
      const paths = Object.values(active.files).filter(Boolean);
      const summary = {
        id: active.id, sessionId: next.sessionId, turnId: active.turnId,
        source: next.source, model: active.model,
        startedAt: active.startedAt, endedAt: at, outcome,
        outputTokens, reasoningTokens: reasoning != null && outputTokens != null ? Math.min(reasoning, outputTokens) : reasoning,
        toolCalls: Math.max(0, (next.observedToolCalls || 0) - active.toolBaseline),
        activeDurationMs: active.activeDurationMs, elapsedMs: Math.max(0, at - active.startedAt),
        linesAdded: active.linesAdded, linesRemoved: active.linesRemoved,
        filesTouched: active.filesOverflow ? null : Object.keys(active.files).length || null,
        files: settings.privacy === "public" && paths.length ? paths : null,
      };
      data.turns = [summary, ...data.turns.filter((turn) => turn.id !== summary.id)].slice(0, 20);
      delete data.active;
    }
  }
  if (settings.privacy !== "public") {
    for (const turn of data.turns) turn.files = null;
    if (data.active) for (const hash of Object.keys(data.active.files)) data.active.files[hash] = null;
  }
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
    activeDurationMs: count(turn.activeDurationMs), elapsedMs: count(turn.elapsedMs),
    linesAdded: count(turn.linesAdded), linesRemoved: count(turn.linesRemoved), filesTouched: count(turn.filesTouched),
    files: settings.privacy === "public" && Array.isArray(turn.files) ? turn.files.map(safeFilePath).filter(Boolean) : null,
  }));
}

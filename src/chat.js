import { safeFilePath } from "./paths.js";
import fs from "node:fs";
import { config, file, readJSON } from "./store.js";
import { readLiveSession } from "./live.js";
import { conversationName } from "./threads.js";
import { estimateCost } from "./pricing.js";
let cache = { key: "", data: {} };
function history() {
  try {
    const target = file("sessions.json"), s = fs.statSync(target);
    const key = `${target}:${s.ino}:${s.mtimeMs}:${s.size}`;
    if (cache.key !== key) cache = { key, data: readJSON("sessions.json") };
    return cache.data;
  } catch (e) { if (e.code === "ENOENT") return {}; throw e; }
}
const number = (v) => Number.isFinite(Number(v)) && v != null ? Math.max(0, Number(v)) : null;
// Only combine observations carrying the selected conversation identity. Lifetime
// aggregates deliberately never enter this view.
export function getChatStats(state = readJSON("state.json"), settings = config()) {
  const id = state.sessionId || null, source = state.source || "codex";
  const index = history(), candidate = id ? index.sessions?.[id] : null;
  const record = candidate && (!candidate.source || candidate.source === source) ? candidate : {};
  const snapshot = readLiveSession(id, source);
  const live = snapshot.sessionId === id && (!snapshot.source || snapshot.source === source) && (snapshot.updatedAt || 0) > (state.updatedAt || 0) ? snapshot : state;
  const totals = record.totals || {}, usage = live.usage || {};
  const known = !!record.usageKnown;
  const count = (key, liveValue) => {
    const a = known ? number(totals[key]) : null, b = id ? number(liveValue) : null;
    return a == null && b == null ? null : Math.max(a || 0, b || 0);
  };
  const tokens = count("tokens", live.tokens ?? usage.total);
  const input = count("input", usage.input), output = count("output", usage.output);
  const cached = count("cached", usage.cached), reasoning = count("reasoning", usage.reasoning);
  const model = live.model || record.model || null;
  const delta = { input: Math.max(0,(input || 0) - (totals.input || 0)), output: Math.max(0,(output || 0) - (totals.output || 0)), cached: Math.max(0,(cached || 0) - (totals.cached || 0)) };
  const extra = estimateCost(model, delta, settings.prices);
  const hasDelta = delta.input + delta.output > 0;
  const unaccounted = Math.max(0, (tokens || 0) - (known ? totals.tokens || 0 : 0) - delta.input - delta.output);
  const unknownCostTokens = (totals.unknownCostTokens || 0) + unaccounted + (hasDelta && extra == null ? delta.input + delta.output : 0);
  const cost = tokens == null ? null : (known ? (number(totals.cost) || 0) : 0) + (extra || 0);
  const recent = [...(record.recentTools || []), ...(live.recentTools || [])];
  const dedup = new Map(recent.map((t) => [t.callId || `${t.name}:${t.startedAt}`, t]));
  const privateMode = settings.privacy !== "public" || settings.presence?.showTask === false;
  const safeTool = (tool) => {
    if (typeof tool === "string") return tool.slice(0, 128);
    const clean = {};
    for (const field of ["name", "callId", "startedAt", "endedAt", "durationMs", "status", "exitCode"])
      if (tool?.[field] !== undefined) clean[field] = tool[field];
    if (!privateMode && safeFilePath(tool?.file)) clean.file = tool.file;
    return clean;
  };
  const contextWindow = number(live.contextWindow), lastRequestTokens = number(live.lastUsage?.total);
  return {
    id, source, title: privateMode ? "Private conversation" : conversationName(id) || (live.taskSource ? live.task : null) || live.project || "Current chat",
    model, status: live.status || "idle", startedAt: record.startedAt || live.startedAt || null,
    lastActivityAt: live.updatedAt || record.lastActivityAt || null,
    historyUpdatedAt: index.updatedAt || null, liveUpdatedAt: live.updatedAt || null,
    tokens, input, output, reasoning, cached,
    cachePercent: input ? Math.min(100, (cached || 0) / input * 100) : null,
    cost: unknownCostTokens && !(cost > 0) ? null : cost, unknownCostTokens,
    prompts: record.id ? number(totals.prompts) : null,
    toolCalls: record.id || live.observedToolCalls != null ? Math.max(totals.toolCalls || 0, live.observedToolCalls || 0) : null,
    tools: totals.tools || {}, languages: totals.languages || {},
    files: privateMode ? {} : Object.fromEntries(Object.entries(totals.files || {}).filter(([name]) => safeFilePath(name))),
    linesAdded: record.id ? number(totals.linesAdded) : null, linesRemoved: record.id ? number(totals.linesRemoved) : null,
    activeSeconds: record.id ? number(totals.activeSeconds) : null,
    activeHours: record.id ? (totals.activeSeconds || 0) / 3600 : null,
    activeTools: (live.activeTools || []).map(safeTool), recentTools: [...dedup.values()].sort((a,b) => (a.startedAt || 0)-(b.startedAt || 0)).slice(-8).map(safeTool),
    lastTool: live.lastTool ? safeTool(live.lastTool) : null, contextWindow, lastRequestTokens,
    contextPercent: contextWindow && lastRequestTokens != null ? Math.min(100,lastRequestTokens/contextWindow*100) : null,
  };
}

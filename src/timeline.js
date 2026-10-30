import { config, readJSON } from "./store.js";
import { readLiveSession } from "./live.js";
import { getChatStats } from "./chat.js";
import { safeFilePath } from "./paths.js";

const time = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
// A timeline is metadata only: no arguments, command strings, output or errors.
export function getToolTimeline(state = readJSON("state.json"), settings = config(), now = Date.now()) {
  if (!state.sessionId) return [];
  const source = state.source || "codex";
  const snapshot = readLiveSession(state.sessionId, source);
  const matches = snapshot.sessionId === state.sessionId && (!snapshot.source || snapshot.source === source);
  const effectiveClosed = ["idle", "waiting"].includes(state.status);
  // The caller's effective state may already have applied idle/privacy policy.
  // Equal-time raw snapshots must not undo that projection.
  const live = matches && !effectiveClosed && (snapshot.updatedAt || 0) > (state.updatedAt || 0) ? snapshot : state;
  // Only use getChatStats for its history merge; fence off its own raw snapshot
  // selection so a mismatched source cannot bypass the identity check above.
  const recent = getChatStats({ ...live, updatedAt: Math.max(live.updatedAt || 0, snapshot.updatedAt || 0) }, settings).recentTools || [];
  const stale = time(live.updatedAt) != null && now - live.updatedAt > (settings.timing?.idleMs ?? 300000);
  const runningAllowed = !effectiveClosed && !["idle", "waiting"].includes(live.status) && !stale;
  const rows = new Map();
  const add = (tool, running = false) => {
    if (!tool || typeof tool !== "object") return;
    const name = String(tool.name || "tool").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 128);
    const startedAt = time(tool.startedAt), endedAt = running ? null : time(tool.endedAt);
    const id = String(tool.callId || tool.id || `${name}:${startedAt}`);
    const status = running ? "running"
      : ["completed", "failed", "unknown"].includes(tool.status) ? tool.status
      : endedAt != null ? "completed" : "unknown";
    const durationMs = running && startedAt != null ? Math.max(0, now - startedAt)
      : time(tool.durationMs) ?? (startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : null);
    const file = settings.privacy === "public" && safeFilePath(tool.file);
    rows.set(id, {
      id, name, status, startedAt, endedAt, durationMs,
      ...(typeof tool.exitCode === "number" && Number.isSafeInteger(tool.exitCode) && !running ? { exitCode: tool.exitCode } : {}),
      ...(file ? { file } : {}),
    });
  };
  recent.forEach((tool) => add(tool));
  (live.recentTools || []).forEach((tool) => add(tool));
  // Tracked active calls override stale historical completion observations.
  (live.activeTools || []).forEach((tool) => add(runningAllowed ? tool : { ...tool, status: "unknown", endedAt: null, durationMs: null }, runningAllowed));
  return [...rows.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || a.id.localeCompare(b.id)).slice(0, 50);
}

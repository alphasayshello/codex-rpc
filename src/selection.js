import { summarizeCommand } from "./watcher.js";
import fs from "node:fs";
import { safeFilePath } from "./paths.js";
import { config, file, readJSON, writeJSON } from "./store.js";
import { readLiveSession } from "./live.js";
import { conversationName } from "./threads.js";

const sourceOK = (source) => source === "codex" || source === "chatgpt";
const key = (id, source) => JSON.stringify([source, id]);
const clean = (value) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 128) : "";
function pin() {
  const value = readJSON("selection.json");
  return typeof value.sessionId === "string" && value.sessionId && sourceOK(value.source) ? value : null;
}
function safeTool(tool, settings) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null;
  const safe = {};
  for (const field of ["name", "callId"])
    if (typeof tool[field] === "string") safe[field] = tool[field].replace(/[\x00-\x1f\x7f]/g, " ").slice(0, field === "name" ? 128 : 256);
  for (const field of ["startedAt", "endedAt", "durationMs"])
    if (typeof tool[field] === "number" && Number.isFinite(tool[field]) && tool[field] >= 0) safe[field] = tool[field];
  if (["running", "completed", "failed", "unknown"].includes(tool.status)) safe.status = tool.status;
  if (typeof tool.exitCode === "number" && Number.isSafeInteger(tool.exitCode)) safe.exitCode = tool.exitCode;
  const file = settings.privacy === "public" && safeFilePath(tool.file);
  if (file) safe.file = file;
  for (const field of ["fileCount", "linesAdded", "linesRemoved"])
    if (Number.isSafeInteger(tool[field]) && tool[field] >= 0) safe[field] = tool[field];
  if (settings.privacy === "public") {
    if (Array.isArray(tool.safeFiles)) safe.safeFiles = tool.safeFiles.slice(0, 32).map(safeFilePath).filter(Boolean);
    const summary = summarizeCommand(tool.commandSummary);
    if (summary) safe.commandSummary = summary;
  }
  return safe;
}
function redact(state, settings) {
  const next = { ...state };
  for (const field of ["activeTools", "recentTools"])
    if (state[field] !== undefined) next[field] = Array.isArray(state[field]) ? state[field].map((tool) => safeTool(tool, settings)).filter(Boolean) : [];
  if (state.lastTool !== undefined) next.lastTool = safeTool(state.lastTool, settings);
  if (settings.privacy !== "public" || settings.presence?.showTask === false) delete next.task;
  if (settings.privacy !== "public") {
    delete next.project;
    delete next.file;
  }
  if (settings.privacy !== "public") { delete next.branch; delete next.commandSummary; delete next.currentFiles; }
  if (next.updatedAt && Date.now() - next.updatedAt > settings.timing.idleMs) {
    next.status = "idle";
    delete next.tool;
    next.activeTools = [];
  }
  return next;
}
export function selectedState(settings = config()) {
  const pinned = pin(), latest = readJSON("state.json", { status: "idle" });
  if (!pinned) return redact(latest, settings);
  const saved = readLiveSession(pinned.sessionId, pinned.source);
  let state = saved.sessionId === pinned.sessionId && saved.source === pinned.source ? saved : null;
  if (latest.sessionId === pinned.sessionId && latest.source === pinned.source &&
    (!state || (latest.updatedAt || 0) > (state.updatedAt || 0))) state = latest;
  if (!state) {
    const histories = readJSON("sessions.json").sessions || {};
    const history = Object.hasOwn(histories, pinned.sessionId) ? histories[pinned.sessionId] : null;
    const record = history && (!history.source || history.source === pinned.source) ? history : {};
    state = { sessionId: pinned.sessionId, source: pinned.source, status: "idle", model: record.model,
      startedAt: record.startedAt, updatedAt: record.lastActivityAt };
  }
  return redact(state, settings);
}
export function listChats(settings = config()) {
  const histories = readJSON("sessions.json").sessions || {}, entries = new Map();
  const add = (id, source, live, record) => {
    if (typeof id !== "string" || !id || !sourceOK(source)) return;
    const idKey = key(id, source), old = entries.get(idKey) || {};
    entries.set(idKey, { id, source, live: live && (!old.live || (live.updatedAt || 0) >= (old.live.updatedAt || 0)) ? live : old.live, record: record || old.record });
  };
  for (const [id, record] of Object.entries(histories)) add(id, record.source || "codex", null, record);
  let names = [];
  try { names = fs.readdirSync(file("live")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  for (const name of names) {
    if (!/^(codex|chatgpt)-[a-f0-9]{64}\.json$/.test(name)) continue;
    const live = readJSON(`live/${name}`);
    add(live.sessionId, live.source, live);
  }
  const latest = readJSON("state.json"), pinned = pin();
  add(latest.sessionId, latest.source || "codex", latest);
  if (pinned) add(pinned.sessionId, pinned.source);
  const result = [...entries.values()].map(({ id, source, live = {}, record = {} }) => {
    const updatedAt = Math.max(live.updatedAt || 0, record.lastActivityAt || 0);
    const visible = settings.privacy === "public" && settings.presence?.showTask !== false;
    return { id, source, title: visible ? clean(conversationName(id)) || clean(live.taskSource && live.task) || clean(live.project) || (source === "chatgpt" ? "ChatGPT conversation" : "Codex conversation") : "Private conversation",
      status: live.status && Date.now() - (live.updatedAt || 0) <= settings.timing.idleMs ? live.status : "idle",
      model: live.model || record.model || null, lastActivityAt: updatedAt || null,
      output: live.usage?.output != null || (record.usageKnown && record.totals?.output != null) ? Math.max(live.usage?.output || 0, record.usageKnown ? record.totals?.output || 0 : 0) : null,
      pinned: pinned?.sessionId === id && pinned.source === source,
      current: latest.sessionId === id && (latest.source || "codex") === source };
  }).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  const chosen = result.slice(0, 100);
  for (const protectedChat of result.filter((chat) => chat.pinned || chat.current)) {
    if (chosen.includes(protectedChat)) continue;
    let index = chosen.length - 1;
    while (index >= 0 && (chosen[index].pinned || chosen[index].current)) index--;
    if (index >= 0) chosen.splice(index, 1, protectedChat);
  }
  return chosen.sort((a,b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}
export function pinChat(id, source = "codex") {
  const histories = readJSON("sessions.json").sessions || {};
  const history = typeof id === "string" && Object.hasOwn(histories, id) ? histories[id] : null;
  const snapshot = typeof id === "string" ? readLiveSession(id, source) : {};
  const latest = readJSON("state.json");
  const exists = (history && (!history.source || history.source === source)) ||
    (snapshot.sessionId === id && snapshot.source === source) ||
    (latest.sessionId === id && (latest.source || "codex") === source);
  if (typeof id !== "string" || !id.trim() || id.length > 256 || !sourceOK(source) ||
    !exists) {
    throw Object.assign(Error("Unknown or invalid conversation"), { statusCode: 400 });
  }
  const selection = { sessionId: id, source, pinnedAt: Date.now() };
  writeJSON("selection.json", selection);
  return { id, source };
}
export function unpinChat() { writeJSON("selection.json", {}); return null; }

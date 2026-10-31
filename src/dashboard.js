import fs from "node:fs";
import { createHash } from "node:crypto";
import { config, file, readJSON } from "./store.js";
import { selectedState, stateForChat, listChats } from "./selection.js";
import { getChatStats } from "./chat.js";
import { getToolTimeline } from "./timeline.js";
import { getTurnRecaps } from "./recaps.js";
import { buildActivity, statusBadgeKind, getVisualState } from "./presence.js";
import { rangeAggregate } from "./tui.js";
import { emptyStats } from "./scanner.js";
import { listPets } from "./pets.js";
import { presenceFilePath } from "./paths.js";

const appVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const signature = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
const invalid = (message) => Object.assign(Error(message), { statusCode: 400 });
const ranges = new Set(["all", "7d", "30d", "90d", "1y"]);

function publicAggregate(value, settings) {
  // Never let an old public scan leak hotspot paths while the new private
  // scan is pending. Keep the cached raw scan untouched for later public use.
  const stats = (record = {}) => {
    const files = new Map();
    if (settings.privacy === "public") for (const [name, count] of Object.entries(record.files || {})) {
      const normalized = presenceFilePath(name);
      if (normalized) files.set(normalized, (files.get(normalized) || 0) + (Number.isFinite(count) ? Math.max(0, count) : 0));
    }
    return { ...record, files: Object.fromEntries(files) };
  };
  return { ...value, totals: stats(value.totals), days: Object.fromEntries(Object.entries(value.days || {}).map(([day, record]) => [day, stats(record)])) };
}
function identity(filename, stat) {
  try { const info = stat(filename); return `${filename}:${info.dev}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`; }
  catch (error) { if (error.code === "ENOENT") return filename + ":missing"; throw error; }
}

// The expensive history JSON and daily reductions change much less often than
// live tools. Cache by actual file identity, UTC day and settings, not a timer.
export function createDashboardReader({ now = () => Date.now(), read = readJSON, stat = fs.statSync } = {}) {
  let history = { key: "", value: null };
  const aggregates = new Map();
  const aggregateVersions = new WeakMap();
  function aggregate(range = "all", settings = config(), date = new Date(now())) {
    if (!ranges.has(range)) throw invalid("Invalid range");
    const current = identity(file("aggregate.json"), stat);
    if (history.key !== current) {
      history = { key: current, value: read("aggregate.json", { totals: emptyStats(), days: {}, streak: { current: 0, longest: 0 } }) };
      aggregates.clear();
    }
    const key = `${current}:${date.toISOString().slice(0, 10)}:${range}:${signature(settings)}`;
    if (!aggregates.has(key)) {
      if (aggregates.size >= 32) aggregates.delete(aggregates.keys().next().value);
      aggregates.set(key, publicAggregate(rangeAggregate(history.value, range, date), settings));
    }
    return aggregates.get(key);
  }
  function snapshot({ range = "30d", chatId, source = "codex" } = {}) {
    if (!ranges.has(range)) throw invalid("Invalid range");
    if (!["codex", "chatgpt"].includes(source)) throw invalid("Invalid conversation source");
    const settings = config(), epoch = now(), date = new Date(epoch);
    const actual = selectedState(settings), actualChat = getChatStats(actual, settings);
    const state = { ...actual, badgeKind: statusBadgeKind(actual), visualState: getVisualState(actual, settings, epoch),
      daemon: read("daemon.json"), enabled: settings.enabled, version: appVersion };
    const viewing = chatId == null ? null : { id: chatId, source };
    if (viewing && (typeof chatId !== "string" || !chatId.trim() || chatId.length > 256 || /[\x00-\x1f\x7f]/.test(chatId))) throw invalid("Invalid conversation ID");
    const viewed = viewing ? stateForChat(chatId, source, settings) : actual;
    const unavailable = !viewed;
    const chat = unavailable ? { ...getChatStats({ source, status: "idle" }, settings), id: chatId,
      title: settings.privacy === "public" && settings.presence.showTask ? "Conversation unavailable" : "Private conversation" }
      : viewing ? getChatStats(viewed, settings) : actualChat;
    const context = viewed || { sessionId: chatId, source };
    const saved = read("selection.json");
    const result = {
      state, aggregate: aggregate(range, settings, date), year: aggregate("1y", settings, date),
      activity: buildActivity(actual, aggregate("all", settings, date), settings, actualChat, epoch), chat,
      chats: { chats: listChats(settings), pinned: saved.sessionId ? { id: saved.sessionId, source: saved.source } : null },
      timeline: { sessionId: context.sessionId || null, source: context.source || "codex", rows: unavailable ? [] : getToolTimeline(context, settings, epoch) },
      recaps: { sessionId: context.sessionId || null, source: context.source || "codex", rows: unavailable ? [] : getTurnRecaps(context, settings) },
      pets: { pets: listPets(settings), selected: settings.pet?.id || "codex" }, viewing,
    };
    result.versions = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "viewing").map(([key, value]) => {
      if (key === "aggregate" || key === "year") {
        if (!aggregateVersions.has(value)) aggregateVersions.set(value, signature(value));
        return [key, aggregateVersions.get(value)];
      }
      return [key, signature(value)];
    }));
    return result;
  }
  return { snapshot, aggregate };
}

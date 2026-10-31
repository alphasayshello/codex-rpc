import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { sandbox } from "./helpers.js";
import { createDashboardReader } from "../src/dashboard.js";
import { config, readJSON, writeJSON } from "../src/store.js";
import { emptyStats } from "../src/scanner.js";
import { liveSessionFile } from "../src/live.js";
import { recapFile } from "../src/recaps.js";
import { pinChat, stateForChat } from "../src/selection.js";
import { getChatStats } from "../src/chat.js";
import { buildActivity } from "../src/presence.js";
import { serve } from "../src/server.js";

test("historical reductions reuse file identity cache, invalidate by UTC day/config/write, and redact old public scans", (t) => {
  sandbox(t); let epoch = Date.parse("2026-10-31T23:59:00Z"), reads = 0;
  const day = { ...emptyStats(), tokens: 100, prompts: 1, files: { "/Users/private/project/data.js": 2, "data.js": 3 } };
  writeJSON("aggregate.json", { totals: day, days: { "2026-10-31": day, "2026-11-01": day }, streak: { current: 1, longest: 1 } });
  const reader = createDashboardReader({ now: () => epoch, read: (name, fallback) => { if (name === "aggregate.json") reads++; return readJSON(name, fallback); } });
  const settings = { ...config(), privacy: "public" };
  const before = reader.aggregate("7d", settings);
  assert.equal(before.totals.tokens, 100); assert.deepEqual(before.totals.files, { "data.js": 5 });
  assert.strictEqual(reader.aggregate("7d", settings), before);
  reader.aggregate("1y", settings); assert.equal(reads, 1);
  const hidden = reader.aggregate("7d", { ...settings, privacy: "private" });
  assert.deepEqual(hidden.totals.files, {}); assert.deepEqual(hidden.days["2026-10-31"].files, {});
  assert.deepEqual(before.totals.files, { "data.js": 5 }); assert.equal(reads, 1);
  epoch = Date.parse("2026-11-01T00:01:00Z");
  const nextDay = reader.aggregate("7d", settings); assert.notStrictEqual(nextDay, before); assert.equal(nextDay.totals.tokens, 200);
  assert.equal(reads, 1);
  const changedSettings = reader.aggregate("7d", { ...settings, stats: { enabled: false } }); assert.notStrictEqual(changedSettings, nextDay);
  writeJSON("aggregate.json", { totals: { ...day, tokens: 300 }, days: { "2026-11-01": { ...day, tokens: 300 } }, streak: { current: 1 } });
  assert.equal(reader.aggregate("7d", settings).totals.tokens, 300); assert.equal(reads, 2);
  assert.throws(() => reader.aggregate("invalid", settings), /Invalid range/);
});

function fixture() {
  const epoch = Date.now(), totals = (output) => ({ ...emptyStats(), output, tokens: output, prompts: 2, toolCalls: 1 });
  writeJSON("config.json", { ...config(), privacy: "public", presence: { ...config().presence, stats: "chat" } });
  writeJSON("aggregate.json", { totals: totals(1000), days: { [new Date(epoch).toISOString().slice(0, 10)]: totals(1000) }, streak: { current: 1 } });
  writeJSON("sessions.json", { updatedAt: epoch, sessions: {
    actual: { id: "actual", source: "codex", usageKnown: true, totals: totals(10) },
    viewed: { id: "viewed", source: "codex", usageKnown: true, totals: totals(50) },
  } });
  writeJSON("state.json", { sessionId: "actual", source: "codex", status: "waiting", updatedAt: epoch, usage: { output: 12 }, project: "actual-project" });
  writeJSON(liveSessionFile("viewed"), { sessionId: "viewed", source: "codex", status: "thinking", updatedAt: epoch, usage: { output: 60 }, project: "viewed-project",
    recentTools: [{ name: "read_file", callId: "viewed-call", startedAt: epoch - 100, endedAt: epoch - 50, file: "secret/source.js", status: "completed" }] });
  writeJSON(recapFile("viewed"), { sessionId: "viewed", source: "codex", turns: [{ id: "turn-1", outputTokens: 6, files: ["secret/source.js"] }] });
  pinChat("actual"); return epoch;
}

test("unified snapshot views another chat without changing live Discord selection and uses stable section signatures", (t) => {
  sandbox(t); const epoch = fixture(), reader = createDashboardReader({ now: () => epoch });
  const selection = readJSON("selection.json"), result = reader.snapshot({ range: "30d", chatId: "viewed", source: "codex" });
  assert.equal(result.state.sessionId, "actual"); assert.equal(result.chat.id, "viewed"); assert.equal(result.chat.output, 60);
  assert.equal(result.timeline.rows[0].id, "viewed-call"); assert.equal(result.recaps.rows[0].id, "turn-1");
  assert.deepEqual(result.viewing, { id: "viewed", source: "codex" });
  assert.match(result.activity.details, /actual-project/); assert.ok(!JSON.stringify(result.activity).includes("viewed-project"));
  assert.deepEqual(readJSON("selection.json"), selection);
  assert.deepEqual(reader.snapshot({ range: "30d", chatId: "viewed" }).versions, result.versions);
  writeJSON("state.json", { sessionId: "actual", source: "codex", status: "waiting", updatedAt: epoch + 1, usage: { output: 13 } });
  const update = reader.snapshot({ range: "30d", chatId: "viewed" });
  assert.notEqual(update.versions.state, result.versions.state);
  for (const section of ["chat", "timeline", "recaps", "aggregate", "year", "pets"]) assert.equal(update.versions[section], result.versions[section], section);
  const unknown = reader.snapshot({ chatId: "viewed", source: "chatgpt" });
  assert.equal(unknown.chat.output, null); assert.equal(unknown.chat.model, null); assert.deepEqual(unknown.timeline.rows, []); assert.deepEqual(unknown.recaps.rows, []);
  assert.equal(unknown.state.sessionId, "actual"); assert.deepEqual(readJSON("selection.json"), selection);
  assert.equal(reader.snapshot().viewing, null);
  assert.throws(() => reader.snapshot({ chatId: "", source: "codex" }), /Invalid conversation ID/);
  assert.throws(() => reader.snapshot({ chatId: "viewed", source: "other" }), /Invalid conversation source/);
  writeJSON("config.json", { ...config(), privacy: "private" });
  const hidden = reader.snapshot({ chatId: "viewed" });
  assert.equal(hidden.chat.title, "Private conversation"); assert.deepEqual(hidden.aggregate.totals.files, {});
  assert.equal(hidden.timeline.rows[0].file, undefined); assert.equal(hidden.recaps.rows[0].files, null);
  assert.ok(!JSON.stringify(hidden).includes("actual-project")); assert.ok(!JSON.stringify(hidden).includes("secret/source.js"));
});

test("legacy source-less Codex records and names never bleed into same-ID ChatGPT views or pins", (t) => {
  const { codex } = sandbox(t); const epoch = Date.now();
  fs.writeFileSync(path.join(codex, "session_index.jsonl"), JSON.stringify({ id: "shared", thread_name: "Codex secret title" }) + "\n");
  writeJSON("sessions.json", { sessions: { shared: { id: "shared", model: "codex-model", usageKnown: true, totals: { output: 1000, tokens: 1000 } } } });
  assert.equal(stateForChat("shared", "chatgpt"), null);
  assert.throws(() => pinChat("shared", "chatgpt"), /Unknown or invalid/);
  const unknown = getChatStats({ sessionId: "shared", source: "chatgpt" }, { ...config(), privacy: "public" });
  assert.equal(unknown.output, null); assert.equal(unknown.model, null); assert.ok(!unknown.title.includes("Codex secret"));
  writeJSON(liveSessionFile("shared", "chatgpt"), { sessionId: "shared", updatedAt: epoch + 100, usage: { output: 9999 }, model: "wrong-source" });
  assert.equal(getChatStats({ sessionId: "shared", source: "chatgpt" }).output, null);
  const activity = buildActivity({ sessionId: "shared", source: "chatgpt", status: "waiting", project: "Desktop", updatedAt: epoch }, {}, { ...config(), privacy: "public", presence: { ...config().presence, stats: "chat" } });
  assert.ok(!activity.details.includes("Codex secret"));
});

test("chat labels and hotspot keys normalize legacy absolute filenames and retain relative metadata", (t) => {
  sandbox(t);
  const files = { "/Users/private/repo/client.js": 2, "C:/Users/private/repo/client.js": 3, "src/other.js": 1, "constructor": 4, ["__proto__"]: 5 };
  writeJSON("sessions.json", { sessions: { legacy: { id: "legacy", source: "codex", usageKnown: true, totals: { files } } } });
  const chat = getChatStats({ sessionId: "legacy", source: "codex", activeTools: [{ name: "edit", file: "/Users/private/repo/client.js" }] }, { ...config(), privacy: "public" });
  assert.deepEqual(chat.files, { "client.js": 5, "src/other.js": 1, "constructor": 4, ["__proto__"]: 5 }); assert.equal(chat.activeTools[0].file, "client.js");
  writeJSON("aggregate.json", { totals: { ...emptyStats(), files }, days: {} });
  assert.deepEqual(createDashboardReader().aggregate("all", { ...config(), privacy: "public" }).totals.files, chat.files);
});

test("unified HTTP route retains Host protection and permits only same-origin studio framing", async (t) => {
  sandbox(t); fixture(); const server = await serve(0); t.after(() => server.closeDashboard());
  const root = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(root + "/api/dashboard?range=7d&chatId=viewed&source=codex");
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.state.sessionId, "actual"); assert.equal(result.chat.id, "viewed");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self';/);
  const tokens = await fetch(root + "/assets/ui/tokens.css"); assert.equal(tokens.status, 200); assert.match(tokens.headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(root + "/api/dashboard?range=nope")).status, 400);
  assert.equal((await fetch(root + "/api/dashboard?chatId=viewed&source=other")).status, 400);
  assert.equal((await fetch(root + "/api/dashboard?chatId=viewed&source=")).status, 400);
  assert.equal(await new Promise((resolve, reject) => http.get(root + "/api/dashboard", { headers: { host: "evil.example" } }, (r) => { r.resume(); resolve(r.statusCode); }).on("error", reject)), 403);
});

test("SSE coalesces a burst of observed files and clears pending timers during shutdown", async (t) => {
  sandbox(t); const server = await serve(0), controller = new AbortController();
  t.after(async () => { controller.abort(); await server.closeDashboard(); });
  const root = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(root + "/events", { signal: controller.signal }), reader = response.body.getReader(), decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: update/);
  const next = reader.read();
  for (let i = 0; i < 6; i++) { writeJSON("state.json", { status: "thinking", tokens: i }); writeJSON("daemon.json", { connected: true }); }
  assert.equal((decoder.decode((await next).value).match(/event: update/g) || []).length, 1);
  const pending = reader.read();
  const outcome = await Promise.race([pending.then(() => "extra"), new Promise((resolve) => setTimeout(() => resolve("quiet"), 150))]);
  assert.equal(outcome, "quiet");
  writeJSON("state.json", { status: "idle" }); await server.closeDashboard();
  await pending;
});

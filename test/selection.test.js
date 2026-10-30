import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox } from "./helpers.js";
import { config, writeJSON, readJSON } from "../src/store.js";
import { liveSessionFile } from "../src/live.js";
import { selectedState, listChats, pinChat, unpinChat } from "../src/selection.js";
import { serve } from "../src/server.js";
const settings = () => ({ ...config(), privacy: "public" });
function fixture() {
  const now = Date.now();
  writeJSON("sessions.json", { sessions: {
    a: { id: "a", source: "codex", model: "gpt-5", lastActivityAt: now - 1000, startedAt: now - 10000, usageKnown: true, totals: { output: 15 } },
    old: { id: "old", source: "codex", model: "o3", lastActivityAt: now - 999999, totals: {} },
  } });
  const a = { sessionId: "a", source: "codex", status: "thinking", model: "gpt-5", updatedAt: now, project: "private-work", task: "User-named chat", taskSource: "explicit", usage: { output: 20 } };
  writeJSON(liveSessionFile("a"), a);
  writeJSON("state.json", { sessionId: "b", source: "codex", status: "working", updatedAt: now + 1, tokens: 999 });
  return a;
}
test("pin persists an independent chat and unpin resumes latest state", (t) => {
  sandbox(t); fixture();
  assert.equal(selectedState(settings()).sessionId, "b");
  assert.deepEqual(pinChat("a"), { id: "a", source: "codex" });
  assert.equal(readJSON("selection.json").sessionId, "a");
  assert.equal(selectedState(settings()).sessionId, "a");
  assert.equal(selectedState(settings()).status, "thinking");
  writeJSON("state.json", { sessionId: "c", source: "codex", status: "waiting", updatedAt: Date.now() + 10 });
  assert.equal(selectedState(settings()).sessionId, "a");
  assert.equal(unpinChat(), null);
  assert.deepEqual(readJSON("selection.json"), {});
  assert.equal(selectedState(settings()).sessionId, "c");
});
test("historical pins and missing pinned histories stay idle without falling through", (t) => {
  sandbox(t); fixture();
  pinChat("old");
  let state = selectedState(settings());
  assert.equal(state.sessionId, "old");
  assert.equal(state.status, "idle");
  assert.equal(state.model, "o3");
  writeJSON("sessions.json", { sessions: {} });
  state = selectedState(settings());
  assert.equal(state.sessionId, "old");
  assert.equal(state.status, "idle");
  assert.equal(state.tokens, undefined);
});
test("source validation prevents collisions and invalid pins", (t) => {
  sandbox(t); fixture();
  const desktop = { sessionId: "a", source: "chatgpt", status: "waiting", model: "desktop", updatedAt: Date.now() };
  writeJSON(liveSessionFile("a", "chatgpt"), desktop);
  pinChat("a", "chatgpt");
  assert.equal(selectedState(settings()).model, "desktop");
  assert.equal(listChats(settings()).filter((chat) => chat.id === "a").length, 2);
  for (const args of [["unknown"], ["constructor"], ["__proto__"], [""], ["x".repeat(257)], ["a", "invalid"], [null]]) {
    assert.throws(() => pinChat(...args), (error) => error.statusCode === 400);
  }
});
test("chat lists expose safe titles and output, respect privacy/showTask and retain capped selections", (t) => {
  const { codex } = sandbox(t); fixture();
  fs.writeFileSync(path.join(codex, "session_index.jsonl"), JSON.stringify({ id: "a", thread_name: "Actual conversation name" }) + "\n");
  pinChat("a");
  let a = listChats(settings()).find((chat) => chat.id === "a");
  assert.equal(a.title, "Actual conversation name");
  assert.equal(a.output, 20);
  assert.equal(a.pinned, true);
  assert.equal(a.current, false);
  assert.equal(listChats(settings()).find((chat) => chat.id === "b").current, true);
  assert.ok(!("project" in a));
  assert.equal(listChats(config()).find((chat) => chat.id === "a").title, "Private conversation");
  assert.equal(listChats({ ...settings(), presence: { showTask: false } }).find((chat) => chat.id === "a").title, "Private conversation");
  assert.equal(selectedState(config()).project, undefined);
  assert.equal(selectedState(config()).task, undefined);
  const sessions = {};
  for (let i = 0; i < 110; i++) sessions[`new-${i}`] = { id: `new-${i}`, source: "codex", lastActivityAt: Date.now() + 10000 + i };
  sessions.ancient = { id: "ancient", source: "codex", lastActivityAt: 1 };
  writeJSON("sessions.json", { sessions });
  const list = listChats(settings());
  assert.equal(list.length, 100);
  assert.ok(list.some((chat) => chat.id === "a" && chat.pinned));
  assert.ok(list.some((chat) => chat.id === "b" && chat.current));
  assert.doesNotThrow(() => pinChat("ancient"));
});
test("selection APIs share selected state and protect pin mutations with CSRF token", async (t) => {
  sandbox(t); fixture();
  const server = await serve(0);
  t.after(() => new Promise((resolve) => { server.closeDashboard(); server.on("close", resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(base + "/api/pin", { method: "POST", body: JSON.stringify({ id: "a" }) });
  assert.equal(response.status, 403);
  const { token } = await (await fetch(base + "/api/session")).json();
  const post = (body) => fetch(base + "/api/pin", { method: "POST", headers: { "x-codex-rpc-token": token }, body: JSON.stringify(body) });
  response = await post({ id: "a" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.sessionId, "a");
  assert.equal((await (await fetch(base + "/api/state")).json()).sessionId, "a");
  assert.equal((await (await fetch(base + "/api/chat")).json()).id, "a");
  const timeline = await (await fetch(base + "/api/timeline")).json();
  assert.equal(timeline.sessionId, "a");
  assert.equal(timeline.source, "codex");
  assert.ok(Array.isArray(timeline.rows));
  const chats = await (await fetch(base + "/api/chats")).json();
  assert.deepEqual(chats.pinned, { id: "a", source: "codex" });
  assert.ok(chats.chats.some((chat) => chat.id === "a" && chat.pinned));
  assert.equal((await post({ id: "missing" })).status, 400);
  assert.equal((await post({ id: null })).status, 200);
  assert.equal((await (await fetch(base + "/api/state")).json()).sessionId, "b");
});
test("selected state and API sanitize nested tools from old public snapshots", async (t) => {
  sandbox(t);
  const tool = { name: "bash", callId: "call-1", startedAt: Date.now(), durationMs: 10, status: "failed", exitCode: 1,
    file: "private/company.js", arguments: { secret: "secret-argument" }, output: "secret-output", command: "secret-command", error: "secret-error" };
  writeJSON("state.json", { sessionId: "old-public", source: "codex", status: "working", updatedAt: Date.now(), activeTools: [tool], recentTools: [tool], lastTool: tool });
  const state = selectedState();
  for (const metadata of [state.activeTools[0], state.recentTools[0], state.lastTool]) {
    assert.deepEqual(Object.keys(metadata).sort(), ["callId", "durationMs", "exitCode", "name", "startedAt", "status"].sort());
    assert.equal(metadata.file, undefined);
    assert.equal(metadata.arguments, undefined);
    assert.equal(metadata.output, undefined);
  }
  const visible = selectedState(settings());
  assert.equal(visible.lastTool.file, "private/company.js");
  assert.equal(visible.lastTool.output, undefined);
  const server = await serve(0);
  t.after(() => new Promise((resolve) => { server.closeDashboard(); server.on("close", resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/state`);
  assert.equal(response.status, 200);
  const text = await response.text();
  for (const secret of ["private/company.js", "secret-argument", "secret-output", "secret-command", "secret-error"])
    assert.ok(!text.includes(secret), `${secret} must be redacted`);
  const payload = JSON.parse(text);
  assert.equal(payload.lastTool.exitCode, 1);
  assert.equal(payload.activeTools[0].name, "bash");
});

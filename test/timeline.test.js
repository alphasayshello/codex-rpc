import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox } from "./helpers.js";
import { applyEvent, toolOutcome } from "../src/hook.js";
import { getToolTimeline } from "../src/timeline.js";
import { config, readJSON, writeJSON } from "../src/store.js";
import { liveSessionFile } from "../src/live.js";
const base = Date.now() - 10000;
const event = (type, n, extra = {}) => ({ type, sessionId: "chat", timestamp: new Date(base + n * 1000).toISOString(), ...extra });

test("outcomes retain only numeric exit metadata, using conservative bounded terminal markers", () => {
  assert.deepEqual(toolOutcome({ output: '{"metadata":{"exit_code":2},"output":"SECRET"}' }), { status: "failed", exitCode: 2 });
  assert.deepEqual(toolOutcome({ payload: { output: { is_error: true, content: "SECRET" } } }), { status: "failed" });
  assert.deepEqual(toolOutcome({ exitCode: 0, output: "SECRET" }), { status: "completed", exitCode: 0 });
  assert.deepEqual(toolOutcome({ output: "Chunk ID: abc\nProcess exited with code 1\nFinal output:\nSECRET" }), { status: "failed", exitCode: 1 });
  assert.deepEqual(toolOutcome({ output: "The file says error and exit code 1" }), { status: "completed" });
  assert.deepEqual(toolOutcome({ output: "x".repeat(5000) + "\nProcess exited with code 1" }), { status: "completed" });
  assert.deepEqual(toolOutcome({ exitCode: "SECRET" }), { status: "completed" });
});

test("parallel tools produce deduplicated running/completed/failed rows and durations", (t) => {
  const { rpc } = sandbox(t);
  applyEvent(event("tool-start", 0, { callId: "one", tool: "exec_command" }));
  applyEvent(event("tool-start", 1, { callId: "two", tool: "apply_patch" }));
  let state = applyEvent(event("tool-end", 2, { callId: "one", output: '{"metadata":{"exit_code":0},"output":"SECRET OUTPUT"}' }));
  let rows = getToolTimeline(state, config(), base + 4000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "two");
  assert.equal(rows[0].status, "running");
  assert.equal(rows[0].durationMs, 3000);
  assert.equal(rows[1].status, "completed");
  assert.equal(rows[1].exitCode, 0);
  assert.equal(rows[1].durationMs, 2000);
  state = applyEvent(event("tool-end", 5, { callId: "two", output: { is_error: true, error: "SECRET ERROR" } }));
  applyEvent(event("tool-end", 5, { callId: "two", output: { is_error: true } }));
  rows = getToolTimeline(state, config(), base + 6000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].durationMs, 4000);
  const disk = fs.readFileSync(path.join(rpc, liveSessionFile("chat")), "utf8");
  assert.ok(!disk.includes("SECRET"));
  assert.ok(!disk.includes('"output"'));
  assert.ok(!disk.includes('"error"'));
});

test("waiting closes unfinished tools as unknown, never fabricated success", (t) => {
  sandbox(t);
  applyEvent(event("function_call", 0, { callId: "one", tool: "shell" }));
  const state = applyEvent(event("waiting", 3));
  const [row] = getToolTimeline(state);
  assert.equal(row.status, "unknown");
  assert.equal(row.durationMs, 3000);
  assert.equal(row.endedAt, base + 3000);
  assert.deepEqual(state.activeTools, []);
});

test("timeline merges matching history/live calls, lets active win, and caps newest rows", (t) => {
  sandbox(t);
  const state = { sessionId: "chat", source: "codex", updatedAt: base,
    recentTools: Array.from({ length: 60 }, (_, i) => ({ name: "read_file", callId: `tool-${i}`, startedAt: base + i, endedAt: base + i + 1, output: "SECRET" })),
    activeTools: [{ name: "read_file", callId: "tool-59", startedAt: base + 59 }],
  };
  writeJSON("sessions.json", { sessions: { chat: { id: "chat", source: "codex", recentTools: [{ name: "read_file", callId: "tool-59", startedAt: base + 59, endedAt: base + 60 }] } } });
  const rows = getToolTimeline(state, config(), base + 100);
  assert.equal(rows.length, 50);
  assert.equal(rows[0].id, "tool-59");
  assert.equal(rows[0].status, "running");
  assert.equal(rows[0].durationMs, 41);
  assert.ok(!JSON.stringify(rows).includes("SECRET"));
  assert.deepEqual(getToolTimeline({}), []);
  writeJSON(liveSessionFile("chat"), { sessionId: "other", source: "codex", updatedAt: 5, activeTools: [{ name: "BAD", callId: "bad" }] });
  assert.ok(!getToolTimeline(state).some((row) => row.name === "BAD"));
});

test("private timelines and future hooks scrub files from existing public snapshots", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  const state = applyEvent(event("tool-start", 0, { callId: "one", tool: "read_file", file: "/secret/project.js" }));
  assert.equal(getToolTimeline(state)[0].file, "/secret/project.js");
  assert.ok(!JSON.stringify(getToolTimeline(state, { ...config(), privacy: "private" })).includes("secret"));
  writeJSON("config.json", { ...config(), privacy: "private" });
  applyEvent(event("thinking", 1));
  assert.ok(!JSON.stringify(readJSON(liveSessionFile("chat"))).includes("secret"));
  assert.ok(!JSON.stringify(readJSON("state.json")).includes("secret"));
});

test("effective idle/waiting projections cannot revive equal-time active snapshots", (t) => {
  sandbox(t);
  const snapshot = { sessionId: "chat", source: "codex", status: "working", updatedAt: base + 1000,
    activeTools: [{ callId: "stale", name: "shell", status: "running", startedAt: base }],
    recentTools: [{ callId: "stale", name: "shell", status: "running", startedAt: base }],
  };
  writeJSON(liveSessionFile("chat"), snapshot);
  for (const status of ["idle", "waiting"]) {
    const state = { ...snapshot, status, activeTools: [] };
    const rows = getToolTimeline(state, config(), base + 5000);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "unknown");
    assert.equal(rows[0].endedAt, null);
    assert.equal(rows[0].durationMs, null);
  }
});

test("stale active observations become unknown without a perpetually ticking duration", (t) => {
  sandbox(t);
  const state = { sessionId: "chat", source: "codex", status: "working", updatedAt: base + 1000,
    activeTools: [{ callId: "stale", name: "shell", startedAt: base }],
  };
  const settings = { ...config(), timing: { ...config().timing, idleMs: 2000 } };
  const first = getToolTimeline(state, settings, base + 4000);
  const later = getToolTimeline(state, settings, base + 8000);
  assert.equal(first[0].status, "unknown");
  assert.equal(first[0].durationMs, null);
  assert.deepEqual(first, later);
  assert.equal(getToolTimeline(state, settings, base + 2000)[0].status, "running");
});

test("same-id snapshots from another source do not contaminate timeline history", (t) => {
  sandbox(t);
  const state = { sessionId: "chat", source: "codex", status: "working", updatedAt: base,
    activeTools: [{ callId: "right", name: "read_file", startedAt: base }],
  };
  writeJSON(liveSessionFile("chat", "codex"), {
    sessionId: "chat", source: "chatgpt", status: "working", updatedAt: base + 1000,
    activeTools: [{ callId: "wrong", name: "BAD" }], recentTools: [{ callId: "wrong", name: "BAD" }],
  });
  const rows = getToolTimeline(state, config(), base + 2000);
  assert.deepEqual(rows.map((row) => row.id), ["right"]);
});

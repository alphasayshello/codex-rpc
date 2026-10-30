import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox } from "./helpers.js";
import { applyEvent } from "../src/hook.js";
import { getTurnRecaps, recapFile } from "../src/recaps.js";
import { config, writeJSON } from "../src/store.js";
const base = Date.now() - 60000;
const event = (type, seconds, extra = {}, sessionId = "chat") => ({ sessionId, timestamp: new Date(base + seconds * 1000).toISOString(), payload: { type, ...extra } });
const usage = (seconds, output, reasoning = 0, sessionId = "chat") => event("token_count", seconds, { info: { total_token_usage: { input_tokens: 90000, output_tokens: output, reasoning_output_tokens: reasoning } } }, sessionId);

test("recaps use output deltas, reasoning subset, observed tools, real durations and recorded changes", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent(usage(0, 100, 10));
  applyEvent(event("user_message", 1, { message: "SECRET PROMPT" }));
  applyEvent(event("task_started", 2, { turn_id: "turn-one", model: "o3" }));
  applyEvent(event("function_call", 3, { call_id: "tool", name: "apply_patch", arguments: JSON.stringify({ path: "/project/a.js", patch: "SECRET PATCH" }), lines_added: 8, lines_removed: 2 }));
  applyEvent(usage(3.5, 130, 20));
  applyEvent(event("message", 4, { role: "user", content: [{ text: "INJECTED SECRET" }] }));
  applyEvent(usage(5, 160, 30));
  applyEvent(event("function_call_output", 6, { call_id: "tool", output: "SECRET OUTPUT" }));
  const done = event("task_complete", 8, { turn_id: "turn-one" });
  const state = applyEvent(done);
  applyEvent(done);
  const [row] = getTurnRecaps(state);
  assert.equal(getTurnRecaps(state).length, 1);
  assert.equal(row.id, "chat:turn-one");
  assert.equal(row.outputTokens, 60);
  assert.equal(row.reasoningTokens, 20);
  assert.equal(row.toolCalls, 1);
  assert.equal(row.elapsedMs, 7000);
  assert.equal(row.activeDurationMs, 7000);
  assert.equal(row.linesAdded, 8);
  assert.equal(row.linesRemoved, 2);
  assert.equal(row.filesTouched, 1);
  assert.deepEqual(row.files, ["/project/a.js"]);
  assert.equal(row.outcome, "completed");
  assert.equal(row.model, "o3");
  const file = path.join(process.env.CODEX_RPC_HOME, recapFile("chat"));
  const disk = fs.readFileSync(file, "utf8");
  assert.ok(!disk.includes("SECRET"));
  assert.ok(!disk.includes("INJECTED"));
  assert.match(recapFile("chat/../../unsafe"), /^recaps\/codex-[a-f0-9]{64}\.json$/);
});

test("missing usage and reset counters stay unknown instead of fabricated zero or negative", (t) => {
  sandbox(t);
  applyEvent(event("turn-start", 0, { turn_id: "missing" }));
  let state = applyEvent(event("task_complete", 1, { turn_id: "missing" }));
  let row = getTurnRecaps(state)[0];
  assert.equal(row.outputTokens, null);
  assert.equal(row.reasoningTokens, null);
  assert.equal(row.linesAdded, null);
  assert.equal(row.filesTouched, null);
  applyEvent(usage(2, 100, 10));
  applyEvent(event("task_started", 3, { turn_id: "reset" }));
  applyEvent(usage(4, 20, 2));
  applyEvent(usage(5, 150, 15));
  state = applyEvent(event("task_complete", 6, { turn_id: "reset" }));
  row = getTurnRecaps(state)[0];
  assert.equal(row.outputTokens, null);
  assert.equal(row.reasoningTokens, null);
  applyEvent(event("task_started", 7, { turn_id: "zero" }));
  applyEvent(usage(8, 150, 15));
  state = applyEvent(event("task_complete", 9, { turn_id: "zero" }));
  assert.equal(getTurnRecaps(state)[0].outputTokens, 0);
});

test("chat/source isolation, aborted and failed outcomes and waiting time exclusion", (t) => {
  sandbox(t);
  applyEvent(usage(0, 10, 2, "A"));
  applyEvent(usage(0, 1000, 100, "B"));
  applyEvent(event("task_started", 1, { turn_id: "same" }, "A"));
  applyEvent(event("task_started", 1, { turn_id: "same" }, "B"));
  applyEvent(event("approval-request", 2, {}, "A"));
  applyEvent(usage(3, 40, 8, "A"));
  const a = applyEvent(event("turn_aborted", 4, { turn_id: "same" }, "A"));
  const b = applyEvent(event("task_failed", 5, { turn_id: "same" }, "B"));
  assert.equal(getTurnRecaps(a)[0].outputTokens, 30);
  assert.equal(getTurnRecaps(a)[0].outcome, "aborted");
  assert.equal(getTurnRecaps(a)[0].activeDurationMs, 2000);
  assert.equal(getTurnRecaps(b)[0].outcome, "failed");
  assert.equal(getTurnRecaps(b)[0].outputTokens, null);
  assert.deepEqual(getTurnRecaps({ sessionId: "A", source: "chatgpt" }), []);
});

test("recaps retain only newest twenty, completion ids deduplicate and privacy redacts old public files", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent(usage(0, 0));
  let state;
  for (let i = 0; i < 23; i++) {
    applyEvent(event("task_started", 1 + i * 4, { turn_id: `turn-${i}` }));
    applyEvent(event("function_call", 2 + i * 4, { call_id: `call-${i}`, name: "read_file", arguments: '{"path":"/private/name.js"}' }));
    applyEvent(usage(3 + i * 4, (i + 1) * 10));
    state = applyEvent(event("task_complete", 4 + i * 4, { turn_id: `turn-${i}` }));
  }
  assert.equal(getTurnRecaps(state).length, 20);
  assert.equal(getTurnRecaps(state)[0].turnId, "turn-22");
  assert.equal(getTurnRecaps(state).at(-1).turnId, "turn-3");
  assert.ok(!JSON.stringify(getTurnRecaps(state, { ...config(), privacy: "private" })).includes("/private"));
  writeJSON("config.json", { ...config(), privacy: "private" });
  applyEvent(event("waiting", 100));
  assert.ok(!fs.readFileSync(path.join(process.env.CODEX_RPC_HOME, recapFile("chat")), "utf8").includes("/private"));
});

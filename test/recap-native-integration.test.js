import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox } from "./helpers.js";
import { applyEvent } from "../src/hook.js";
import { config, readJSON, writeJSON } from "../src/store.js";
import { getTurnRecaps, recapFile, recordTurnEvent } from "../src/recaps.js";
const state = { sessionId: "native-chat", source: "codex" };
const patch = "*** Begin Patch\n*** Update File: src/a.js\n@@\n-SECRET_OLD\n+SECRET_NEW\n+next\n*** Add File: src/b.js\n+second\n*** End Patch";
const native = (hook_event_name, at, extra = {}) => applyEvent({ ...state, session_id: state.sessionId, hook_event_name, timestamp: at, ...extra });
const log = (type, at, extra = {}) => applyEvent({ ...state, type, timestamp: at, ...extra });
const usage = (at, output, turnId, reasoning = 10) => log("token_count", at, { turnId, usage: { input: 1000, output, reasoning } });
const recaps = () => getTurnRecaps(state);

test("native/log duplicate patch observations count all safe files and parsed successful changes once", (t) => {
  const { rpc } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  usage(500, 100);
  native("UserPromptSubmit", 1000, { turn_id: "A", prompt: "SECRET PROMPT" });
  native("PreToolUse", 2000, { turn_id: "A", tool_use_id: "patch", tool_name: "apply_patch", tool_input: { command: patch } });
  log("function_call", 2100, { turnId: "A", payload: { type: "function_call", name: "apply_patch", call_id: "patch", arguments: JSON.stringify({ patch }) } });
  native("PostToolUse", 3000, { turn_id: "A", tool_use_id: "patch", tool_name: "apply_patch", tool_input: { command: patch }, tool_response: { success: true, output: "SECRET STDOUT" } });
  log("function_call_output", 3100, { turnId: "A", callId: "patch", payload: { type: "function_call_output", call_id: "patch", output: '{"metadata":{"exit_code":0},"output":"SECRET BODY"}', lines_added: 3, lines_removed: 1 } });
  usage(3500, 150, "A");
  native("Stop", 4000, { turn_id: "A", last_assistant_message: "SECRET ANSWER" });
  const [row] = recaps();
  assert.equal(row.toolCalls, 1);
  assert.equal(row.linesAdded, 3);
  assert.equal(row.linesRemoved, 1);
  assert.equal(row.filesTouched, 2);
  assert.deepEqual(row.files.sort(), ["src/a.js", "src/b.js"]);
  assert.equal(row.outputTokens, 50);
  assert.equal(row._usage, undefined);
  assert.ok(!fs.readFileSync(path.join(rpc, recapFile(state.sessionId)), "utf8").includes("SECRET"));
});

test("failed and unknown native edits do not claim proposed lines were applied", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  for (const [turnId, response] of [["failed", { success: false, error: "SECRET ERROR" }], ["unknown", {}]]) {
    const at = turnId === "failed" ? 1000 : 5000;
    native("UserPromptSubmit", at, { turn_id: turnId });
    native("PreToolUse", at + 100, { turn_id: turnId, tool_use_id: turnId, tool_name: "apply_patch", tool_input: { command: patch } });
    native("PostToolUse", at + 200, { turn_id: turnId, tool_use_id: turnId, tool_name: "apply_patch", tool_response: response });
    native("Stop", at + 300, { turn_id: turnId });
    const row = recaps()[0];
    assert.equal(row.linesAdded, null);
    assert.equal(row.linesRemoved, null);
    assert.equal(row.filesTouched, 2);
    assert.deepEqual(row.files.sort(), ["src/a.js", "src/b.js"]);
  }
});

test("late final usage with matching turn identity reconciles a closed recap without reviving lifecycle", (t) => {
  sandbox(t);
  usage(500, 100, undefined, 10);
  native("UserPromptSubmit", 1000, { turn_id: "A" });
  usage(2000, 150, "A", 20);
  native("Stop", 4000, { turn_id: "A" });
  usage(3000, 200, "A", 30);
  assert.equal(recaps()[0].outputTokens, 100);
  assert.equal(recaps()[0].reasoningTokens, 20);
  assert.equal(readJSON("state.json").status, "waiting");
  assert.equal(readJSON("state.json").eventTime, 4000);
  assert.equal(readJSON("state.json").usage.output, 200);
  usage(3000, 200, "A", 30);
  assert.equal(recaps().length, 1);
  assert.equal(recaps()[0].outputTokens, 100);
});

test("late older-turn usage never becomes newer-turn output and can refine a proven earlier baseline", (t) => {
  sandbox(t);
  usage(500, 100);
  native("UserPromptSubmit", 1000, { turn_id: "A" });
  usage(2000, 150, "A");
  native("Stop", 4000, { turn_id: "A" });
  native("UserPromptSubmit", 5000, { turn_id: "B" });
  usage(6000, 250, "B");
  native("Stop", 7000, { turn_id: "B" });
  usage(3000, 200, "A");
  const byId = Object.fromEntries(recaps().map((row) => [row.turnId, row]));
  assert.equal(byId.A.outputTokens, 100);
  assert.equal(byId.B.outputTokens, 50);
  assert.equal(readJSON("state.json").usage.output, 250);
  assert.equal(readJSON("state.json").eventTime, 7000);
});

test("unidentified late samples do not guess recap ownership; missing/reset baselines remain unknown", (t) => {
  sandbox(t);
  native("UserPromptSubmit", 1000, { turn_id: "missing" });
  usage(2000, 20, "missing");
  native("Stop", 4000, { turn_id: "missing" });
  usage(3000, 30, "missing");
  assert.equal(recaps()[0].outputTokens, null);
  native("UserPromptSubmit", 5000, { turn_id: "reset" });
  usage(6000, 2, "reset");
  native("Stop", 8000, { turn_id: "reset" });
  usage(7000, 40, "reset");
  assert.equal(recaps()[0].outputTokens, null);
  const before = JSON.stringify(recaps());
  usage(7500, 50, undefined);
  assert.equal(JSON.stringify(recaps()), before);
});

test("late reconciliation redacts saved public files and stays per conversation/source", (t) => {
  const { rpc } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  usage(500, 100);
  native("UserPromptSubmit", 1000, { turn_id: "A" });
  native("PreToolUse", 1500, { turn_id: "A", tool_use_id: "patch", tool_name: "apply_patch", tool_input: { command: patch } });
  native("PostToolUse", 2000, { turn_id: "A", tool_use_id: "patch", tool_name: "apply_patch", tool_response: { success: true } });
  native("Stop", 4000, { turn_id: "A" });
  writeJSON("config.json", { ...config(), privacy: "private" });
  usage(3000, 120, "A");
  assert.equal(recaps()[0].files, null);
  assert.ok(!fs.readFileSync(path.join(rpc, recapFile(state.sessionId)), "utf8").includes("src/a.js"));
  assert.deepEqual(getTurnRecaps({ sessionId: state.sessionId, source: "chatgpt" }), []);
  assert.deepEqual(getTurnRecaps({ sessionId: "other", source: "codex" }), []);
  // An old file without stored per-turn accounting cannot be reconstructed.
  writeJSON(recapFile("legacy"), { sessionId: "legacy", source: "codex", turns: [{ id: "legacy:A", turnId: "A", outputTokens: null }] });
  recordTurnEvent({ tokenOnly: true, turnId: "A", recapUsage: { output: 500 } }, {}, { sessionId: "legacy", source: "codex" }, 10, config());
  assert.equal(getTurnRecaps({ sessionId: "legacy" })[0].outputTokens, null);
});

test("private queued hooks keep parsed numeric changes but do not guess unique paths", (t) => {
  sandbox(t);
  native("UserPromptSubmit", 1000, { turn_id: "private" });
  for (const [i, id] of ["one", "two"].entries()) {
    native("PreToolUse", 1500 + i * 1000, { turn_id: "private", tool_use_id: id, tool_name: "apply_patch", tool_input: { command: patch } });
    native("PostToolUse", 1800 + i * 1000, { turn_id: "private", tool_use_id: id, tool_name: "apply_patch", tool_response: { success: true } });
  }
  native("Stop", 4000, { turn_id: "private" });
  const [row] = recaps();
  assert.equal(row.linesAdded, 6);
  assert.equal(row.linesRemoved, 2);
  assert.equal(row.filesTouched, null);
  assert.equal(row.files, null);
  assert.equal(row.toolCalls, 2);
});

test("late closed-turn tools never inflate the next turn's deduplicated tool count", (t) => {
  sandbox(t);
  native("UserPromptSubmit", 1000, { turn_id: "A" });
  native("Stop", 2000, { turn_id: "A" });
  native("UserPromptSubmit", 3000, { turn_id: "B" });
  const before = readJSON("state.json");
  native("PreToolUse", 1500, { turn_id: "A", tool_use_id: "late-A", tool_name: "Bash", tool_input: { command: "npm test" } });
  native("PostToolUse", 1800, { turn_id: "A", tool_use_id: "late-A", tool_name: "Bash", tool_response: { success: true } });
  const after = readJSON("state.json");
  assert.equal(after.turnId, "B");
  assert.equal(after.status, before.status);
  assert.equal(after.operationStartedAt, before.operationStartedAt);
  assert.equal(after.thinkingStartedAt, before.thinkingStartedAt);
  native("Stop", 4000, { turn_id: "B" });
  const turnB = recaps().find((row) => row.turnId === "B");
  assert.equal(turnB.toolCalls, 0);
  assert.equal(recaps().length, 2);
});

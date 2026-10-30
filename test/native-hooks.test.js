import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { sandbox } from "./helpers.js";
import { applyEvent, normalizeEvent, drainHookEvents } from "../src/hook.js";
import { readJSON, writeJSON, config } from "../src/store.js";
import { readLiveSession } from "../src/live.js";

const epoch = Date.parse("2026-10-30T12:00:00Z");
const native = (hook_event_name, extra = {}, at = 0) => ({
  hook_event_name, session_id: "native-chat", turn_id: "native-turn",
  cwd: "/work/native-secret-project", model: "o3", timestamp: epoch + at,
  ...extra,
});
const cli = fileURLToPath(new URL("../bin/codex-rpc.js", import.meta.url));
const direct = fileURLToPath(new URL("../src/hook.js", import.meta.url));
function run(script, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => stdout += data);
    child.stderr.on("data", (data) => stderr += data);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

test("official native callbacks map lifecycle while source and subagent events cannot alter parent identity", (t) => {
  sandbox(t);
  for (const [name, status] of [
    ["SessionStart", "waiting"], ["UserPromptSubmit", "thinking"],
    ["PreToolUse", "working"], ["PostToolUse", "thinking"],
    ["PermissionRequest", "waiting"], ["Stop", "waiting"],
    ["Interrupt", "waiting"], ["SessionEnd", "idle"],
    ["PreCompact", "thinking"], ["PostCompact", "thinking"],
  ]) {
    const event = normalizeEvent(native(name, { source: "resume", tool_name: "Bash", tool_use_id: "id" }));
    assert.equal(event.status, status, name);
    assert.equal(event.source, "codex");
    assert.equal(event.sessionId, "native-chat");
    assert.equal(event.turnId, "native-turn");
  }
  applyEvent(native("SessionStart", { source: "fork" }));
  const before = readJSON("state.json");
  for (const name of ["SubagentStart", "SubagentStop", "UnknownFutureHook"]) {
    assert.equal(applyEvent(native(name)), null);
    assert.deepEqual(readJSON("state.json"), before);
  }
  assert.equal(before.source, "codex");
  assert.equal(before.waitingReason, "ready");
});

test("native Bash and apply_patch emit safe telemetry and deduplicate shared log call IDs", (t) => {
  const { rpc } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent(native("UserPromptSubmit", { prompt: "HIDDEN_PROMPT", last_assistant_message: "HIDDEN_ASSISTANT" }));
  let state = applyEvent(native("PreToolUse", {
    tool_name: "Bash", tool_use_id: "shared-call",
    tool_input: { command: "API_KEY=HIDDEN_ARGUMENT npm test --token HIDDEN_ARGUMENT" },
  }, 10));
  assert.equal(state.commandSummary, "npm test");
  assert.equal(state.activeTools[0].name, "bash");
  state = applyEvent({ type: "response_item", sessionId: "native-chat", turn_id: "native-turn", timestamp: epoch + 11,
    payload: { type: "function_call", call_id: "shared-call", name: "exec_command", arguments: '{"cmd":"npm test --token HIDDEN_ARGUMENT"}' } });
  assert.equal(state.observedToolCalls, 1);
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "shared-call",
    tool_response: { stdout: "HIDDEN_OUTPUT", metadata: { exit_code: 2 } } }, 20));
  assert.equal(state.lastTool.status, "failed");
  assert.equal(state.lastTool.exitCode, 2);
  assert.equal(state.visualState, "error");
  const patch = "*** Begin Patch\n*** Update File: src/native.js\n@@\n-HIDDEN_OLD\n+HIDDEN_NEW\n+HIDDEN_NEW_AGAIN\n*** End Patch";
  state = applyEvent(native("PreToolUse", { tool_name: "apply_patch", tool_use_id: "patch-call", tool_input: { command: patch } }, 30));
  assert.equal(state.file, "src/native.js");
  assert.equal(state.linesAdded, 2);
  assert.equal(state.linesRemoved, 1);
  assert.equal(state.operationKind, "editing");
  state = applyEvent(native("PostToolUse", { tool_name: "apply_patch", tool_use_id: "patch-call", tool_input: { command: patch }, tool_response: { status: "success", output: "HIDDEN_OUTPUT" } }, 40));
  assert.equal(state.lastTool.status, "completed");
  assert.equal(state.observedToolCalls, 2);
  const contents = [];
  const collect = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const item = path.join(dir, entry.name); if (entry.isDirectory()) collect(item); else contents.push(fs.readFileSync(item, "utf8"));
  } };
  collect(rpc);
  assert.ok(!contents.join("\n").includes("HIDDEN_"));
});

test("native missing/failed responses stay honest and post-before-pre cannot revive a completed call", (t) => {
  sandbox(t);
  let state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "early-post" }, 20));
  assert.equal(state.lastTool.status, "unknown");
  assert.equal(state.lastTool.startedAt, undefined);
  state = applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "early-post", tool_input: { command: "npm test" } }, 30));
  assert.equal(state.status, "thinking");
  assert.equal(state.activeTools.length, 0);
  assert.equal(state.observedToolCalls, 1);
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "failed-post", tool_response: { error: "HIDDEN failure" } }, 40));
  assert.equal(state.lastTool.status, "failed");
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "empty-post", tool_response: {} }, 50));
  assert.equal(state.lastTool.status, "unknown");
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "plain-post", tool_response: "ordinary output is not proof of success" }, 60));
  assert.equal(state.lastTool.status, "unknown");
  applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "approval-call" }, 70));
  applyEvent(native("PermissionRequest", { tool_name: "Bash", tool_use_id: "approval-call" }, 80));
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "approval-call", tool_response: { exit_code: 0 } }, 90));
  assert.equal(state.lastTool.status, "completed");
  assert.equal(state.observedToolCalls, 5);
});

test("late log cumulative tokens update only matching usage without regressing native lifecycle or timers", (t) => {
  sandbox(t);
  applyEvent(native("UserPromptSubmit", {}, 100));
  const before = applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "native-newer" }, 200));
  const count = (sessionId, input, output, time) => applyEvent({ type: "event_msg", sessionId, turn_id: "native-turn", timestamp: epoch + time,
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output, reasoning_output_tokens: 5 } } } });
  let state = count("native-chat", 100, 20, 150);
  assert.equal(state.tokens, 120);
  for (const key of ["status", "eventTime", "startedAt", "operationStartedAt", "updatedAt", "tool"]) assert.equal(state[key], before[key]);
  assert.deepEqual(state.activeTools, before.activeTools);
  state = count("native-chat", 50, 10, 160);
  assert.equal(state.tokens, 120);
  applyEvent({ type: "thinking", source: "codex", sessionId: "other-chat", timestamp: epoch + 300 });
  count("native-chat", 110, 30, 170);
  assert.equal(readJSON("state.json").sessionId, "other-chat");
  assert.equal(readLiveSession("native-chat").tokens, 140);
});

test("private native snapshots and queue events omit raw payloads, names and commands", (t) => {
  const { rpc } = sandbox(t);
  const state = applyEvent(native("PreToolUse", { tool_name: "apply_patch", tool_use_id: "private-patch",
    tool_input: { command: "*** Begin Patch\n*** Add File: secret.js\n+HIDDEN_SOURCE\n*** End Patch" }, prompt: "HIDDEN_PROMPT" }));
  assert.equal(state.linesAdded, 1);
  assert.equal(state.currentFileCount, 1);
  assert.equal(state.activeTools[0].fileCount, 1);
  assert.ok(!JSON.stringify(state).includes("secret.js"));
  assert.ok(!JSON.stringify(state).includes("native-secret-project"));
  fs.writeFileSync(path.join(rpc, "event-drain.lock"), JSON.stringify({ pid: process.pid, nonce: "held-test" }));
  assert.equal(applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "queued", tool_input: { command: "npm test --key HIDDEN_ARGUMENT" } }, 10)), null);
  const pending = fs.readdirSync(path.join(rpc, "events")).map((name) => fs.readFileSync(path.join(rpc, "events", name), "utf8")).join("");
  assert.ok(!pending.includes("HIDDEN_"));
  assert.ok(!pending.includes("commandSummary"));
  assert.ok(!pending.includes("native-secret-project"));
  fs.unlinkSync(path.join(rpc, "event-drain.lock"));
  drainHookEvents();
});

test("real CLI and direct hooks accept pretty JSON, JSONL and argument forms with exact Stop stdout", async (t) => {
  const { env } = sandbox(t);
  for (const [script, args, input] of [
    [cli, ["hook", JSON.stringify(native("SessionStart"))], undefined],
    [cli, ["hook"], JSON.stringify(native("UserPromptSubmit", { prompt: "HIDDEN_PROMPT" }, 1), null, 2)],
    [direct, [], JSON.stringify(native("PreCompact", {}, 2), null, 2)],
    [cli, ["hook"], '{"type":"working"}\n{"type":"idle"}\n'],
  ]) {
    assert.deepEqual(await run(script, args, input, env), { code: 0, stdout: "", stderr: "" });
  }
  for (const [script, args] of [[cli, ["hook"]], [direct, []]])
    assert.deepEqual(await run(script, args, JSON.stringify({ ...native("Stop"), timestamp: Date.now() + 1000 }, null, 2), env), { code: 0, stdout: "{}", stderr: "" });
  assert.equal(readJSON("state.json").waitingReason, "done");
});

test("native observational failures fail open, while malformed legacy hooks still fail", async (t) => {
  const { env, temp } = sandbox(t);
  let result = await run(cli, ["hook"], '{"hook_event_name":"Stop", BROKEN', env);
  assert.deepEqual(result, { code: 0, stdout: "{}", stderr: "" });
  result = await run(cli, ["hook"], '{"type":"BROKEN",', env);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /JSON/);
  result = await run(direct, [], JSON.stringify({ prompt: "x".repeat(1024 * 1024 + 1), hook_event_name: "Stop" }), env);
  assert.deepEqual(result, { code: 0, stdout: "{}", stderr: "" });
  const blocked = path.join(temp, "not-a-directory"); fs.writeFileSync(blocked, "blocked");
  result = await run(direct, [], JSON.stringify(native("Stop")), { ...env, CODEX_RPC_HOME: blocked });
  assert.deepEqual(result, { code: 0, stdout: "{}", stderr: "" });
});

test("native Stop responds even with collection disabled and changes no live state", async (t) => {
  const { env, rpc } = sandbox(t);
  writeJSON("config.json", { ...config(), enabled: false });
  assert.equal(applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "disabled" })), null);
  assert.deepEqual(await run(cli, ["hook"], JSON.stringify(native("Stop")), env), { code: 0, stdout: "{}", stderr: "" });
  assert.equal(fs.existsSync(path.join(rpc, "state.json")), false);
  assert.equal(fs.existsSync(path.join(rpc, "events")), false);
});

test("real parallel native callbacks without producer timestamps retain all calls in three rounds", async (t) => {
  const { env } = sandbox(t);
  for (let round = 0; round < 3; round++) {
    const id = `parallel-native-${round}`;
    const results = await Promise.all(Array.from({ length: 32 }, (_, i) => run(cli, ["hook"], JSON.stringify({
      hook_event_name: "PreToolUse", session_id: id, turn_id: `turn-${round}`,
      tool_name: "Bash", tool_use_id: `call-${i}`, tool_input: { command: "npm test" },
    }), env)));
    for (const result of results) assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
    for (let i = 0; i < 10; i++) if (!drainHookEvents().queued) break;
    const state = readLiveSession(id);
    assert.equal(state.observedToolCalls, 32, `round ${round}`);
    assert.equal(state.activeTools.length, 32, `round ${round}`);
    assert.equal(new Set(state.activeTools.map((tool) => tool.callId)).size, 32);
  }
});

test("closed-turn late calls stay historical and compact SessionStart preserves the active turn", (t) => {
  sandbox(t);
  applyEvent(native("UserPromptSubmit", {}, 0));
  let state = applyEvent(native("SessionStart", { source: "compact" }, 10));
  assert.equal(state.status, "thinking");
  assert.equal(state.turnId, "native-turn");
  assert.equal(state.turnClosedAt, undefined);
  const stopped = applyEvent(native("Stop", {}, 200));
  state = applyEvent(native("PreToolUse", { tool_name: "Bash", tool_use_id: "late-closed" }, 100));
  assert.equal(state.status, "waiting");
  assert.equal(state.activeTools.length, 0);
  assert.equal(state.recentTools[0].status, "unknown");
  assert.equal(state.observedToolCalls, 1);
  state = applyEvent(native("PostToolUse", { tool_name: "Bash", tool_use_id: "late-closed", tool_response: { exit_code: 0 } }, 300));
  assert.equal(state.status, "waiting");
  assert.equal(state.eventTime, stopped.eventTime);
  assert.equal(state.recentTools[0].status, "completed");
  assert.equal(state.observedToolCalls, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, jsonl } from "./helpers.js";
import { patchTelemetry, toolTelemetry, summarizeCommand, wrapperTelemetry } from "../src/watcher.js";
import { applyEvent } from "../src/hook.js";
import { LogWatcher } from "../src/log-watcher.js";
import { config, writeJSON, readJSON } from "../src/store.js";
import { readLiveSession } from "../src/live.js";
const base = Date.now();
const at = (delta) => new Date(base + delta).toISOString();
const patch = "*** Begin Patch\n*** Update File: src/client.js\n@@\n keep\n-old\n+new\n+++ content starting with plus\n--- content starting with minus\n*** Add File: test/client.test.js\n+one\n+two\n*** End Patch";
const event = (type, delta, extra = {}) => ({ type, sessionId: "a", timestamp: at(delta), ...extra });
function publicMode() { writeJSON("config.json", { ...config(), privacy: "public" }); }

test("real multiline and JSON-escaped patches count actual lines across safe files", () => {
  assert.deepEqual(patchTelemetry(patch), { safeFiles: ["src/client.js", "test/client.test.js"], linesAdded: 4, linesRemoved: 2 });
  const raw = toolTelemetry({ payload: { type: "custom_tool_call", name: "apply_patch", input: patch } });
  const escaped = toolTelemetry({ payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ patch }) } });
  assert.deepEqual(raw, escaped);
  assert.equal(raw.file, "src/client.js");
  assert.deepEqual(patchTelemetry("diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n"), { safeFiles: ["src/a.js"], linesAdded: 1, linesRemoved: 1 });
  assert.equal(patchTelemetry("*** Begin Patch\n*** Delete File: old.js\n*** End Patch").linesRemoved, undefined);
});
test("JSON edit replacements strip unchanged context and unknown writes stay unknown", () => {
  const result = toolTelemetry({ payload: { name: "edit_file", arguments: JSON.stringify({ file_path: "src/main.js", old_string: "keep\nold\nend\n", new_string: "keep\nnew\nextra\nend\n" }) } });
  assert.deepEqual(result, { safeFiles: ["src/main.js"], file: "src/main.js", linesAdded: 2, linesRemoved: 1, operationKind: "editing" });
  const unknown = toolTelemetry({ tool: "write_file", payload: { arguments: { path: "src/a.js", content: "secret file content" } } });
  assert.equal(unknown.linesAdded, undefined);
  assert.equal(unknown.linesRemoved, undefined);
  assert.equal(unknown.file, "src/a.js");
  assert.deepEqual(toolTelemetry({ tool: "edit_file", payload: { arguments: { path: "bad\nsecret" } } }), { operationKind: "editing" });
});
test("command summaries never retain flags, values, URLs or arbitrary operands", () => {
  for (const [command, expected] of [
    ["npm test -- --token super-secret", "npm test"],
    ["TOKEN=super-secret npm run build --secret value", "npm run build"],
    ["npm run super-secret", "npm run"],
    ["git commit -m 'private message'", "git commit"],
    ["curl https://secret.example?token=secret", "curl"],
    ["node /private/secret-script.js", "node"],
    ["echo 'super-secret'", undefined],
    ["bash -lc 'npm test --token secret'", "bash"],
  ]) assert.equal(summarizeCommand(command), expected);
  const metadata = toolTelemetry({ tool: "exec_command", payload: { arguments: JSON.stringify({ cmd: "npm test --token super-secret", env: { SECRET: "private-env" } }) } });
  assert.deepEqual(metadata, { commandSummary: "npm test", operationKind: "shell" });
});
test("parallel calls own their files and replace cumulative operation counts", (t) => {
  sandbox(t); publicMode();
  let state = applyEvent(event("custom_tool_call", 100, { callId: "patch", tool: "apply_patch", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "patch", input: patch } }));
  assert.equal(state.linesAdded, 4);
  assert.equal(state.linesRemoved, 2);
  assert.equal(state.currentFileCount, 2);
  assert.equal(state.operationStartedAt, base + 100);
  state = applyEvent(event("custom_tool_call", 110, { callId: "patch", tool: "apply_patch", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "patch", input: patch } }));
  assert.equal(state.linesAdded, 4);
  assert.equal(state.observedToolCalls, 1);
  assert.equal(state.operationStartedAt, base + 100);
  state = applyEvent(event("tool-start", 200, { tool: "bash", callId: "bash", command: "npm test --token super-secret" }));
  assert.equal(state.commandSummary, "npm test");
  assert.equal(state.linesAdded, 4);
  assert.equal(state.operationStartedAt, base + 200);
  state = applyEvent(event("tool-end", 300, { callId: "patch" }));
  assert.equal(state.status, "working");
  assert.equal(state.commandSummary, "npm test");
  assert.equal(state.currentFiles, undefined);
  assert.equal(state.linesAdded, undefined);
  assert.equal(state.operationStartedAt, base + 200);
  state = applyEvent(event("tool-end", 400, { callId: "bash" }));
  assert.equal(state.status, "thinking");
  assert.equal(state.commandSummary, undefined);
  assert.equal(state.thinkingStartedAt, base + 400);
  assert.equal(state.operationStartedAt, base + 400);
  assert.ok(!JSON.stringify(state).includes("super-secret"));
});
test("thinking timers survive token updates; stale events and other chats cannot leak", (t) => {
  sandbox(t); publicMode();
  let state = applyEvent(event("turn-start", 100));
  state = applyEvent(event("token_count", 250, { usage: { input: 10, output: 3, total: 13 } }));
  assert.equal(state.thinkingStartedAt, base + 100);
  assert.equal(state.operationStartedAt, base + 100);
  state = applyEvent(event("tool-start", 300, { tool: "edit_file", callId: "edit", payload: { type: "tool-start", name: "edit_file", arguments: { path: "src/a.js", old_string: "a", new_string: "b" } } }));
  assert.equal(state.file, "src/a.js");
  const b = applyEvent(event("turn-start", 500, { sessionId: "b" }));
  assert.equal(b.file, undefined);
  assert.equal(b.linesAdded, undefined);
  assert.equal(b.tokens, undefined);
  assert.equal(b.thinkingStartedAt, base + 500);
  applyEvent(event("idle", 200));
  assert.equal(readLiveSession("a").status, "working");
  assert.equal(readJSON("state.json").sessionId, "b");
});
test("private hooks keep counts and timers while stripping identifiers from every tool", (t) => {
  sandbox(t); publicMode();
  applyEvent(event("custom_tool_call", 100, { tool: "apply_patch", callId: "p", cwd: "/secret/project", payload: { type: "custom_tool_call", name: "apply_patch", input: patch } }));
  writeJSON("config.json", { ...config(), privacy: "private" });
  const state = applyEvent(event("token_count", 200, { usage: { total: 100 } }));
  assert.equal(state.currentFileCount, 2);
  assert.equal(state.currentFiles, undefined);
  assert.equal(state.file, undefined);
  assert.equal(state.project, undefined);
  assert.equal(state.commandSummary, undefined);
  assert.equal(state.branch, undefined);
  assert.equal(state.linesAdded, 4);
  assert.equal(state.operationStartedAt, base + 100);
  const text = JSON.stringify(state);
  assert.ok(!text.includes("src/client.js"));
  assert.ok(!text.includes("test/client.test.js"));
  assert.ok(!text.includes("safeFiles"));
  const subsequent = applyEvent(event("token_count", 300, { usage: { total: 110 } }));
  assert.equal(subsequent.currentFileCount, 2);
  assert.equal(subsequent.currentFiles, undefined);
});
test("log watcher reads custom-tool inputs, current chat model usage and aliases", (t) => {
  const { codex } = sandbox(t); publicMode();
  const filename = path.join(codex, "sessions/live.jsonl");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  jsonl(filename, [
    { type: "session_meta", payload: { id: "watched", cwd: "/workspace/demo" } },
    { type: "turn_context", payload: { model: "gpt-5" } },
    { type: "response_item", timestamp: at(100), payload: { type: "custom_tool_call", name: "exec", call_id: "patch", input: `await tools.apply_patch(${JSON.stringify(patch)});` } },
    { type: "event_msg", timestamp: at(200), payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } },
  ]);
  new LogWatcher().poll();
  const state = readLiveSession("watched");
  assert.equal(state.model, "gpt-5");
  assert.equal(state.operationKind, "editing");
  assert.equal(state.tokens, 120);
  assert.equal(state.linesAdded, 4);
  assert.equal(state.operationStartedAt, base + 100);
  for (const [type, status, visualState] of [["writing", "working", "writing"], ["patching", "working", "patching"], ["planning", "thinking", "thinking"], ["stuck", "waiting", "error"], ["success", "waiting", "done"], ["sleeping", "idle", "idle"]]) {
    const next = applyEvent({ type, sessionId: type, timestamp: at(300) });
    assert.equal(next.status, status);
    assert.equal(next.visualState, visualState);
  }
});

test("failed tool exits select panic until a real next operation or reasoning event", (t) => {
  sandbox(t);
  applyEvent(event("tool-start", 100, { callId: "bash", tool: "bash" }));
  let state = applyEvent(event("tool-end", 200, { callId: "bash", exitCode: 2 }));
  assert.equal(state.visualState, "error");
  assert.equal(state.lastTool.exitCode, 2);
  state = applyEvent(event("token_count", 250, { usage: { total: 100 } }));
  assert.equal(state.visualState, "error");
  assert.equal(state.thinkingStartedAt, base + 200);
  state = applyEvent(event("reasoning", 300));
  assert.equal(state.visualState, undefined);
  state = applyEvent(event("tool-start", 400, { callId: "retry", tool: "bash" }));
  assert.equal(state.visualState, undefined);
  assert.equal(state.operationStartedAt, base + 400);
});

test("exec wrappers extract only static tool calls without executing JavaScript", (t) => {
  sandbox(t); publicMode();
  const code = `const result = await tools.apply_patch(${JSON.stringify(patch)});\nawait tools.exec_command({cmd: "npm test --token super-secret", env: {TOKEN: "private-env"}});`;
  const parsed = wrapperTelemetry(code);
  assert.equal(parsed.operationKind, "editing");
  assert.equal(parsed.effectiveTool, "apply_patch");
  assert.equal(parsed.linesAdded, 4);
  assert.equal(parsed.linesRemoved, 2);
  assert.equal(parsed.commandSummary, "npm test");
  const state = applyEvent(event("custom_tool_call", 100, { payload: { type: "custom_tool_call", name: "exec", call_id: "wrapper", input: code } }));
  assert.equal(state.tool, "exec");
  assert.equal(state.operationKind, "editing");
  assert.equal(state.effectiveTool, "apply_patch");
  assert.equal(state.file, "src/client.js");
  assert.equal(state.linesAdded, 4);
  assert.equal(state.currentFileCount, 2);
  const text = JSON.stringify(state);
  for (const secret of ["super-secret", "private-env", "const result", "*** Begin Patch", "old\n"]) assert.ok(!text.includes(secret));
  const command = toolTelemetry({ payload: { name: "functions.exec", input: 'await tools.exec_command({"cmd":"npm run build --secret private-value"})' } });
  assert.deepEqual(command, { commandSummary: "npm run build", effectiveTool: "exec_command", operationKind: "shell" });
});
test("wrapper literal parser rejects fake calls and dynamic expressions", () => {
  const fake = `tools.apply_patch(${JSON.stringify(patch)})`;
  const cases = [
    `// ${fake}\nconst x = 1;`,
    `/* ${fake} */`,
    JSON.stringify(fake),
    "`" + fake + "`",
    `const pattern = /tools.apply_patch("fake")/;`,
    `await tools.apply_patch(${JSON.stringify(patch)} + secret);`,
    'await tools.apply_patch(`*** Begin Patch\n*** Add File: ${secret}\n+x\n*** End Patch`)',
    'await tools.exec_command({cmd: "npm test" + secret});',
    'await tools.exec_command({cmd: command});',
    'await tools.exec_command({...options, cmd: "npm test"});',
    'await tools.exec_command({cmd: "npm test", ...options});',
    'await tools.exec_command({cmd: "npm test", cmd: secret});',
    'await tools.exec_command({cmd: "npm test", get cmd() {return secret}});',
    'await tools.exec_command({[key]: secret, cmd: "npm test"});',
    'await tools.exec_command(options);',
    'await fake.tools.exec_command({cmd: "npm test"});',
    'const message = `outer ${`nested tools.exec_command({cmd:"npm test"})`} end`;',
  ];
  for (const code of cases) assert.deepEqual(wrapperTelemetry(code), {}, code);
  assert.deepEqual(wrapperTelemetry("x".repeat(1024 * 1024 + 1)), {});
});
test("literal wrapper templates, escapes and separate patches aggregate safely", () => {
  const first = "*** Begin Patch\n*** Add File: first.js\n+a\n*** End Patch";
  const second = "*** Begin Patch\n*** Add File: second.js\n+b\n+c\n*** End Patch";
  const result = wrapperTelemetry(`await tools.apply_patch(\`${first}\`); await tools.apply_patch(${JSON.stringify(second)});`);
  assert.deepEqual(result.safeFiles, ["first.js", "second.js"]);
  assert.equal(result.linesAdded, 3);
  assert.equal(result.linesRemoved, 0);
  const escaped = wrapperTelemetry(String.raw`await tools.exec_command({cmd: '\u006e\x70m test --token secret'});`);
  assert.equal(escaped.commandSummary, "npm test");
  const nestedContext = toolTelemetry({ tool: "edit_file", payload: { arguments: { path: "a.js", old_string: "A\nB\nC\nD", new_string: "A\nX\nC\nY\nD" } } });
  assert.equal(nestedContext.linesAdded, 2);
  assert.equal(nestedContext.linesRemoved, 1);
});
test("partial or malformed apply patches retain files without fabricating zero diffs", () => {
  for (const value of [
    "*** Update File: src/a.js\n@@\n-old\n+new\n*** End Patch",
    "*** Begin Patch\n*** Update File: src/a.js\n*** End Patch",
    "*** Begin Patch\n*** Update File: src/a.js\n@@\n*** End Patch",
    "*** Begin Patch\n*** Update File: src/a.js\n@@\n-old\n+new",
    "*** Begin Patch\n*** Add File: src/a.js\n+new",
    "*** Begin Patch\n*** Add File: src/a.js\n*** End Patch",
    "*** Begin Patch\n*** Update File: src/a.js\n*** Move to: src/b.js\n@@\n*** End Patch",
    "*** Begin Patch\n*** Add File: src/a.js\n+new\n*** Update File: src/b.js\n*** End Patch",
  ]) {
    const result = patchTelemetry(value);
    assert.ok(result.safeFiles.includes("src/a.js"), value);
    assert.equal(result.linesAdded, undefined, value);
    assert.equal(result.linesRemoved, undefined, value);
  }
});
test("unified and binary diffs require complete declared hunks before exposing totals", () => {
  for (const value of [
    "--- a/src/a.js\n+++ b/src/a.js",
    "diff --git a/src/a.js b/src/a.js\nindex 123..456 100644",
    "diff --git a/src/a.js b/src/a.js\nBinary files a/src/a.js and b/src/a.js differ",
    "diff --git a/src/a.js b/src/a.js\nGIT binary patch\nliteral 10\nencoded-body",
    "--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n-old\n+new",
    "--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @\n-old\n+new",
    "--- a/src/a.js\n+++ b/src/a.js\n@@ -0,0 +0,0 @@",
    "--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n+undeclared-extra",
    "--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n--- a/src/b.js\n+++ b/src/b.js",
  ]) {
    const result = patchTelemetry(value);
    assert.ok(result.safeFiles.includes("src/a.js"), value);
    assert.equal(result.linesAdded, undefined, value);
    assert.equal(result.linesRemoved, undefined, value);
  }
});
test("complete no-change contexts and pure moves have known zero while deletion size stays unknown", () => {
  assert.deepEqual(patchTelemetry("*** Begin Patch\n*** Update File: src/a.js\n@@\n unchanged\n*** End Patch"), { safeFiles: ["src/a.js"], linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(patchTelemetry("*** Begin Patch\n*** Update File: src/a.js\n*** Move to: src/b.js\n*** End Patch"), { safeFiles: ["src/a.js", "src/b.js"], linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(patchTelemetry("--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n unchanged\n"), { safeFiles: ["src/a.js"], linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(patchTelemetry("*** Begin Patch\n*** Delete File: src/a.js\n*** End Patch"), { safeFiles: ["src/a.js"], linesAdded: 0 });
  assert.deepEqual(patchTelemetry("--- /dev/null\n+++ b/src/a.js\n@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n"), { safeFiles: ["src/a.js"], linesAdded: 1, linesRemoved: 0 });
});

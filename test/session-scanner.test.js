import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, jsonl } from "./helpers.js";
import { parseFile, scan } from "../src/scanner.js";
import { config, readJSON, writeJSON } from "../src/store.js";
import { estimateCost } from "../src/pricing.js";

const base = Date.parse("2026-10-29T12:00:00Z");
const row = (type, payload, seconds = 0) => ({
  type, payload, timestamp: new Date(base + seconds * 1000).toISOString(),
});
const usage = (input, output) => ({ input_tokens: input, output_tokens: output });

test("per-chat accounting selects usage and prompt streams independently", async (t) => {
  const { codex } = sandbox(t);
  const f = jsonl(path.join(codex, "sessions/mixed.jsonl"), [
    row("session_meta", { id: "modern", originator: "chatgpt" }),
    row("turn_context", { model: "o3" }),
    row("event_msg", { type: "user_message", message: "secret prompt" }),
    row("response_item", { type: "message", role: "user", content: [{ text: "injected context" }] }),
    row("token_usage_record", { response_id: "same-id", usage: usage(1000, 100) }, 1),
    row("token_usage_record", { response_id: "same-id", usage: usage(1000, 100) }, 1),
    row("event_msg", { type: "token_count", info: { total_token_usage: usage(1000, 100) } }, 1),
    row("response_item", { type: "function_call", name: "apply_patch", call_id: "tool", arguments: '{"patch":"*** Update File: secret.js\\n+yes\\n-no"}' }, 2),
    row("response_item", { type: "function_call_output", call_id: "tool", output: "secret output" }, 4),
    row("session_meta", { id: "legacy" }, 10),
    row("turn_context", { model: "o4-mini" }, 10),
    row("response_item", { type: "message", role: "user", content: [{ text: "fallback prompt" }] }, 10),
    row("event_msg", { type: "token_count", info: { total_token_usage: usage(200, 20) } }, 11),
    row("event_msg", { type: "token_count", info: { total_token_usage: usage(300, 30) } }, 12),
    row("response_item", { type: "function_call", name: "shell", call_id: "tool", arguments: '{"command":"npm test"}' }, 13),
    row("response_item", { type: "function_call", name: "read_file", call_id: "read", arguments: '{"path":"other.py"}' }, 14),
  ]);
  const parsed = await parseFile(f);
  const a = parsed.sessions.modern, b = parsed.sessions.legacy;
  assert.equal(a.totals.tokens, 1100);
  assert.equal(b.totals.tokens, 330);
  assert.equal(parsed.totals.tokens, 1430);
  assert.equal(a.totals.prompts, 1);
  assert.equal(b.totals.prompts, 1);
  assert.equal(a.totals.toolCalls, 1);
  assert.equal(b.totals.toolCalls, 2);
  assert.equal(a.source, "chatgpt");
  assert.equal(b.source, "codex");
  assert.equal(a.totals.activeSeconds, 4);
  assert.equal(b.totals.activeSeconds, 4);
  assert.equal(a.usageKnown, true);
  assert.equal(b.usageKnown, true);
  assert.equal(a.totals.cost, estimateCost("o3", { input: 1000, output: 100 }));
  assert.ok(Math.abs(b.totals.cost - estimateCost("o4-mini", { input: 300, output: 30 })) < 1e-12);
  assert.deepEqual(a.recentTools, [{ name: "apply_patch", callId: "tool", startedAt: base + 2000, endedAt: base + 4000, durationMs: 2000 }]);
  assert.equal(b.totals.languages.Python, 1);
  assert.equal(a.totals.linesAdded, 1);
  assert.equal(a.totals.linesRemoved, 1);
  const metadata = JSON.stringify([a.recentTools, b.recentTools]);
  assert.ok(!metadata.includes("secret"));
  assert.ok(!metadata.includes("npm test"));
});

test("sessions snapshot survives cache reuse, redacts private hotspots and drops deleted chats", async (t) => {
  const { codex, rpc } = sandbox(t);
  const f = jsonl(path.join(codex, "sessions/chat.jsonl"), [
    row("session_meta", { id: "actual-chat-id" }),
    row("turn_context", { model: "gpt-5" }),
    ...Array.from({ length: 10 }, (_, i) => row("response_item", {
      type: "function_call", name: "read_file", call_id: `tool-${i}`, arguments: '{"path":"private.js"}',
    }, i + 1)),
  ]);
  await scan();
  let snapshot = readJSON("sessions.json");
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.sessions["actual-chat-id"].usageKnown, false);
  assert.equal(snapshot.sessions["actual-chat-id"].recentTools.length, 8);
  assert.equal(snapshot.sessions["actual-chat-id"].recentTools[0].callId, "tool-2");
  assert.deepEqual(snapshot.sessions["actual-chat-id"].totals.files, {});
  assert.ok(!fs.readFileSync(path.join(rpc, "sessions.json"), "utf8").includes("private.js"));
  writeJSON("config.json", { ...config(), privacy: "public" });
  assert.equal((await scan()).filesReused, 1);
  snapshot = readJSON("sessions.json");
  assert.equal(snapshot.sessions["actual-chat-id"].totals.files["private.js"], 10);
  fs.unlinkSync(f);
  await scan();
  assert.deepEqual(readJSON("sessions.json").sessions, {});
});

test("history fallback splits interleaved chat IDs without invented tokens or bridged time", async (t) => {
  const { codex } = sandbox(t);
  jsonl(path.join(codex, "history.jsonl"), [
    { session_id: "one", ts: base / 1000, text: "first" },
    { session_id: "two", ts: base / 1000 + 30, text: "second" },
    { session_id: "one", ts: base / 1000 + 60, text: "third" },
  ]);
  const aggregate = await scan();
  const { sessions } = readJSON("sessions.json");
  assert.equal(sessions.one.totals.prompts, 2);
  assert.equal(sessions.two.totals.prompts, 1);
  assert.equal(sessions.one.totals.activeSeconds, 60);
  assert.equal(sessions.two.totals.activeSeconds, 0);
  assert.equal(sessions.one.usageKnown, false);
  assert.equal(sessions.two.totals.tokens, 0);
  assert.equal(aggregate.totals.prompts, 3);
  assert.equal(aggregate.totals.sessions, 2);
});

test("hotspots never retain escaped patch bodies or shell/source suffixes", async (t) => {
  const { codex, rpc } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  const secret = "DO_NOT_PERSIST_SOURCE";
  const patch = `*** Begin Patch\n*** Update File: src/safe.js\n+${secret}\n*** End Patch`;
  jsonl(path.join(codex, "sessions/escaped-patch.jsonl"), [
    row("session_meta", { id: "patch-chat" }),
    row("response_item", {
      type: "function_call", name: "exec_command", call_id: "shell",
      arguments: JSON.stringify({ cmd: `node -e 'const patch = ${JSON.stringify(patch)}'` }),
    }),
    row("response_item", {
      type: "custom_tool_call", name: "apply_patch", call_id: "source-as-input",
      input: `const patch = ${JSON.stringify(patch)};`,
    }),
    row("response_item", {
      type: "custom_tool_call", name: "apply_patch", call_id: "escaped-body",
      input: `*** Update File: src/bad.js\\n+${secret}\\n*** End Patch`,
    }),
    row("response_item", {
      type: "custom_tool_call", name: "apply_patch", call_id: "shell-suffix",
      input: `*** Update File: src/bad.js'); ${secret};\n+change`,
    }),
    row("response_item", {
      type: "function_call", name: "read_file", call_id: "bad-path",
      arguments: JSON.stringify({ path: `src/bad.js\n${secret}` }),
    }),
    row("response_item", {
      type: "custom_tool_call", name: "apply_patch", call_id: "valid",
      input: "*** Begin Patch\r\n*** Update File: src/valid file.js\r\n+safe\r\n*** End Patch",
    }),
  ]);
  await scan();
  const expected = { "src/valid file.js": 1 };
  assert.deepEqual(readJSON("aggregate.json").totals.files, expected);
  assert.deepEqual(readJSON("sessions.json").sessions["patch-chat"].totals.files, expected);
  assert.equal(readJSON("scanner-cache.json").schemaVersion, 6);
  for (const name of ["aggregate.json", "sessions.json", "scanner-cache.json"])
    assert.ok(!fs.readFileSync(path.join(rpc, name), "utf8").includes(secret), name);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, jsonl } from "./helpers.js";
import { conversationName } from "../src/threads.js";
import { applyEvent } from "../src/hook.js";
import { buildActivity } from "../src/presence.js";
import { config, writeJSON, readJSON } from "../src/store.js";
test("named conversation wins over latest message and refreshes after rename", (t) => {
  const { codex } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  const index = jsonl(path.join(codex, "session_index.jsonl"), [
    {
      id: "chat",
      thread_name: "Codex RPC",
      updated_at: "2026-10-29T12:00:00Z",
    },
  ]);
  applyEvent({
    type: "user_message",
    "thread-id": "chat",
    message: "ok next message",
  });
  assert.equal(readJSON("state.json").task, "Codex RPC");
  applyEvent({
    type: "user_message",
    "thread-id": "chat",
    message: "a completely different message",
  });
  assert.equal(readJSON("state.json").task, "Codex RPC");
  fs.appendFileSync(
    index,
    JSON.stringify({
      id: "chat",
      thread_name: "Discord presence suite",
      updated_at: "2026-10-29T13:00:00Z",
    }) + "\n",
  );
  const activity = buildActivity(readJSON("state.json"), {}, config());
  assert.match(activity.state, /Discord presence suite/);
  assert.ok(!JSON.stringify(activity).includes("a completely different message"));
});
test("metadata tolerates partial rows and stale records without replacing the newest name", (t) => {
  const { codex } = sandbox(t);
  const index = jsonl(path.join(codex, "session_index.jsonl"), [
    {
      id: "chat",
      thread_name: "Current title",
      updated_at: "2026-10-29T13:00:00Z",
    },
    {
      id: "chat",
      thread_name: "Old title",
      updated_at: "2026-10-29T12:00:00Z",
    },
  ]);
  fs.appendFileSync(index, '{"partial":');
  assert.equal(conversationName("chat"), "Current title");
  assert.equal(conversationName("missing"), undefined);
});
test("unnamed chats use the project fallback, not a stale latest-message title", (t) => {
  sandbox(t);
  const card = buildActivity(
    {
      sessionId: "unnamed",
      task: "latest chat message",
      project: "codex-rpc",
      status: "working",
    },
    {},
    { privacy: "public" },
  );
  assert.equal(card.details, "Working in codex-rpc");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox, jsonl } from "./helpers.js";
import path from "node:path";
import { buildActivity, taskTitle } from "../src/presence.js";
import { applyEvent } from "../src/hook.js";
import { config, writeJSON, readJSON } from "../src/store.js";
test("Watching card follows task / today / lifetime / status / churn layout", () => {
  const day = new Date().toISOString().slice(0, 10),
    a = buildActivity(
      {
        status: "waiting",
        waitingReason: "done",
        task: "Turn an APK into a Unity project",
        taskSource: "explicit",
        model: "gpt-5",
        tokens: 142800,
        usage: { input: 120000, output: 22800 },
        sessionId: "fixture-cost",
        startedAt: 1700000000000,
      },
      {
        totals: { cost: 24300, activeHours: 200 },
        days: { [day]: { cost: 1040, linesAdded: 1055, linesRemoved: 21 } },
        streak: { current: 4 },
      },
      {
        privacy: "public",
        presence: { type: 3, stats: "cost", showTask: true, showChurn: true },
      },
    );
  assert.equal(a.type, 3);
  assert.equal(a.details, "Turn an APK into a Unity project");
  assert.equal(
    a.state,
    "$1.04k today · $24.3k all-time · Done · your move · +1055 −21",
  );
  assert.match(a.assets.small_image, /codex-status-waiting\.png/);
  assert.match(a.assets.large_text, /gpt-5.*22.8k output tokens/);
  assert.equal(a.timestamps.start, 1700000000);
});
test("conversation names stay private by default and survive public tool/completion events", (t) => {
  const { codex } = sandbox(t);
  jsonl(path.join(codex, "session_index.jsonl"), [
    {
      id: "chat",
      thread_name: "Make the CLI simpler",
      updated_at: "2026-10-29T12:00:00Z",
    },
  ]);
  applyEvent({
    type: "user_message",
    message: "Fix the private checkout\nExtra secret details",
  });
  assert.equal(readJSON("state.json").task, undefined);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent({
    type: "user_message",
    "thread-id": "chat",
    message:
      "This latest message must not replace the chat name\nFull prompt stays out of state",
  });
  applyEvent({ type: "tool-start", tool: "apply_patch" });
  applyEvent({ type: "agent-turn-complete" });
  assert.equal(readJSON("state.json").task, "Make the CLI simpler");
  assert.ok(!JSON.stringify(readJSON("state.json")).includes("Full prompt"));
  const card = buildActivity(
    { ...readJSON("state.json"), project: "secret-company" },
    {},
    { ...config(), privacy: "private" },
  );
  assert.ok(!JSON.stringify(card).includes("secret-company"));
  assert.ok(!JSON.stringify(card).includes("Make the CLI simpler"));
});
test("approval, model/token mode, task cleanup and source context filtering", () => {
  assert.equal(
    taskTitle("<environment_context>private context</environment_context>"),
    undefined,
  );
  assert.equal(taskTitle("/goal Build a CLI\nMore details"), "Build a CLI");
  assert.equal(
    taskTitle([{ type: "input_text", text: "Repair tests" }]),
    "Repair tests",
  );
  const a = buildActivity(
    {
      status: "waiting",
      waitingReason: "approval",
      model: "o4-mini",
      tokens: 1000,
      usage: { input: 800, output: 200 },
      sessionId: "fixture-token",
    },
    {},
    { presence: { stats: "tokens", type: 0 } },
  );
  assert.equal(a.type, 0);
  assert.equal(a.state, "o4-mini · 200 output tokens · Needs approval");
});

test("short acknowledgements do not replace the task title; settings can disable title storage", (t) => {
  sandbox(t);
  for (const text of ["yes", "pushed", "continue", "ok!"])
    assert.equal(taskTitle(text), undefined);
  writeJSON("config.json", {
    ...config(),
    privacy: "public",
    presence: { ...config().presence, showTask: false },
  });
  applyEvent({ type: "user_message", message: "A task we do not want saved" });
  assert.equal(readJSON("state.json").task, undefined);
});

test("pixel status badge follows tool activity, approvals and errors", async (t) => {
  sandbox(t);
  const { statusBadgeKind } = await import("../src/presence.js");
  for (const [tool, badge] of [
    ["exec_command", "working"],
    ["apply_patch", "editing"],
    ["read_file", "reading"],
    ["review", "review"],
  ])
    assert.equal(statusBadgeKind({ status: "working", tool }), badge);
  assert.equal(
    statusBadgeKind({ status: "waiting", waitingReason: "approval" }),
    "approval",
  );
  assert.equal(
    statusBadgeKind({ status: "waiting", waitingReason: "done" }),
    "waiting",
  );
  applyEvent({ type: "task_failed" });
  const card = buildActivity(readJSON("state.json"), {}, config());
  assert.match(card.assets.small_text, /Blocked/);
  assert.match(card.assets.small_image, /codex-status-error\.png/);
});

test("Claude-style status frames count only selected-chat output tokens", (t) => {
  sandbox(t);
  const now = 1700000010000;
  const state = { sessionId: "frames", source: "codex", project: "codex-rpc", model: "o4-mini", tool: "exec_command", file: "/workspace/src/index.js", tokens: 9999999 };
  const chat = { tokens: 9999999, input: 9977199, output: 22800, prompts: 6, toolCalls: 18, activeTools: [{ name: "exec_command", startedAt: now - 65000 }] };
  const c = { ...config(), privacy: "public", presence: { ...config().presence, stats: "chat" } };
  const a = { totals: { tokens: 1e12 }, days: { [new Date().toISOString().slice(0, 10)]: { activeSeconds: 5400 } } };
  const expected = {
    working: ["Working in codex-rpc", "Bash · index.js · 1.1min · 22.8k output tokens"],
    thinking: ["Thinking in codex-rpc", "o4-mini · 6 prompts · 22.8k output tokens"],
    waiting: ["Waiting on you · codex-rpc", "o4-mini · 6 prompts"],
    idle: ["Idle in codex-rpc", "o4-mini · 1.5h today"],
  };
  for (const [status, [details, text]] of Object.entries(expected)) {
    const activity = buildActivity({ ...state, status }, a, c, chat, now);
    assert.equal(activity.details, details);
    assert.equal(activity.state, text);
    assert.ok(!JSON.stringify(activity).includes("9.9M"));
  }
  const missing = buildActivity({ ...state, status: "working", file: undefined }, a, c, { ...chat, output: null, activeTools: [] }, now);
  assert.equal(missing.state, "Bash");
  const privateCard = buildActivity({ ...state, status: "working" }, a, { ...c, privacy: "private" }, chat, now);
  assert.ok(!JSON.stringify(privateCard).includes("index.js"));
});

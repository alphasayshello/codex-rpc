import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox } from "./helpers.js";
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
        model: "gpt-5",
        tokens: 142800,
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
  assert.match(a.assets.large_text, /gpt-5.*142.8K tokens/);
  assert.equal(a.timestamps.start, 1700000000);
});
test("task titles stay private by default and survive public tool/completion events", (t) => {
  sandbox(t);
  applyEvent({
    type: "user_message",
    message: "Fix the private checkout\nExtra secret details",
  });
  assert.equal(readJSON("state.json").task, undefined);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent({
    type: "user_message",
    message: "Make the CLI simpler\nFull prompt stays out of state",
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
    },
    {},
    { presence: { stats: "tokens", type: 0 } },
  );
  assert.equal(a.type, 0);
  assert.equal(a.state, "o4-mini · 1K tokens · Needs approval");
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
  assert.match(card.state, /Blocked/);
  assert.match(card.assets.small_image, /codex-status-error\.png/);
});

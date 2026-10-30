import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, jsonl } from "./helpers.js";
import { parseFile, scan, streaks, emptyStats } from "../src/scanner.js";
import { estimateCost } from "../src/pricing.js";
import { config, readJSON, writeJSON } from "../src/store.js";
import { LogWatcher } from "../src/log-watcher.js";
const date = (days = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const row = (type, payload, day = date(), seconds = 0) => ({
  type,
  timestamp: `${day}T10:00:${String(seconds).padStart(2, "0")}Z`,
  payload,
});
function fixture(codex) {
  return jsonl(path.join(codex, "sessions/2026/10/sample.jsonl"), [
    row("session_meta", { id: "a", cwd: "/work/demo" }),
    row("turn_context", { model: "o4-mini" }),
    row("event_msg", { type: "user_message", message: "fix it" }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "fix it" }],
    }),
    row(
      "response_item",
      {
        type: "function_call",
        call_id: "tool1",
        name: "apply_patch",
        arguments: JSON.stringify({
          patch: "*** Update File: src/app.js\n+hello\n+world\n-old",
        }),
      },
      date(),
      1,
    ),
    row(
      "response_item",
      {
        type: "function_call",
        call_id: "tool1",
        name: "apply_patch",
        arguments: "{}",
      },
      date(),
      2,
    ),
    row(
      "response_item",
      {
        type: "function_call",
        call_id: "tool2",
        name: "shell",
        arguments: JSON.stringify({ command: "npm test", file_path: "x.py" }),
      },
      date(),
      3,
    ),
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cached_input_tokens: 100,
            reasoning_output_tokens: 20,
          },
        },
      },
      date(),
      4,
    ),
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cached_input_tokens: 100,
            reasoning_output_tokens: 20,
          },
        },
      },
      date(),
      5,
    ),
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1500,
            output_tokens: 150,
            cached_input_tokens: 150,
            reasoning_output_tokens: 30,
          },
        },
      },
      date(),
      6,
    ),
    row("event_msg", { type: "task_complete" }, date(), 7),
  ]);
}
test("real-shaped JSONL: prompts deduped, cumulative usage, languages, churn and cached pricing", async (t) => {
  const { codex } = sandbox(t);
  const result = await parseFile(fixture(codex));
  const s = result.totals;
  assert.equal(s.prompts, 1);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.input, 1500);
  assert.equal(s.output, 150);
  assert.equal(s.reasoning, 30);
  assert.equal(s.tokens, 1650);
  assert.equal(s.cached, 150);
  assert.equal(s.languages.JavaScript, 1);
  assert.equal(s.languages.Python, 1);
  assert.equal(s.linesAdded, 2);
  assert.equal(s.linesRemoved, 1);
  assert.equal(s.commands.npm, 1);
  assert.ok(Math.abs(s.cost - 0.00218625) < 1e-12);
  assert.equal(s.activeSeconds, 7);
  assert.equal(result.latest.status, "waiting");
  assert.ok(!JSON.stringify(result.latest).includes("fix it"));
});
test("scan reuses unchanged files, reparses modified files, removes deleted files, ignores malformed tails", async (t) => {
  const { codex } = sandbox(t);
  const f = fixture(codex);
  let a = await scan();
  assert.equal(a.filesScanned, 1);
  assert.equal(a.totals.tokens, 1650);
  assert.deepEqual(a.totals.files, {});
  a = await scan();
  assert.equal(a.filesReused, 1);
  assert.equal(a.filesScanned, 0);
  fs.appendFileSync(
    f,
    JSON.stringify(
      row("event_msg", { type: "user_message", message: "again" }, date(), 8),
    ) + '\n{"partial":',
  );
  a = await scan();
  assert.equal(a.totals.prompts, 2);
  assert.equal(a.totals.tokens, 1650);
  fs.unlinkSync(f);
  a = await scan();
  assert.equal(a.totals.sessions, 0);
});
test("history fallback, source breakdown, unknown models and streak boundaries", async (t) => {
  const { codex } = sandbox(t);
  jsonl(path.join(codex, "history.jsonl"), [
    {
      session_id: "a",
      ts: Date.parse(date() + "T12:00:00Z") / 1000,
      text: "hello",
    },
  ]);
  const a = await scan();
  assert.equal(a.totals.prompts, 1);
  assert.equal(a.totals.sessions, 1);
  assert.equal(a.streak.current, 1);
  const days = Object.fromEntries(
    [0, -1, -2, -4].map((d) => [date(d), { ...emptyStats(), prompts: 1 }]),
  );
  assert.deepEqual(streaks(days), { current: 3, longest: 3 });
  assert.equal(streaks({ [date(-1)]: days[date(-1)] }).current, 1);
  assert.equal(streaks({ [date(-2)]: days[date(-2)] }).current, 0);
  assert.equal(estimateCost("unpriced", {}), null);
  assert.equal(
    estimateCost("o3", { input: 100, output: 50, reasoning: 40 }),
    0.0006,
  );
  assert.equal(
    estimateCost("gpt-5-2025-08-07", { input: 1000000, output: 0 }),
    1.25,
  );
});
test("ChatGPT-origin log attribution and public hotspot files", async (t) => {
  const { codex } = sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  jsonl(path.join(codex, "sessions/chatgpt.jsonl"), [
    row("session_meta", { id: "desktop", originator: "chatgpt" }),
    row("turn_context", { model: "o3" }),
    row("event_msg", { type: "user_message", message: "hey" }, date(-1)),
    row(
      "response_item",
      {
        type: "function_call",
        name: "read_file",
        arguments: '{"path":"app.js"}',
      },
      date(-1),
      1,
    ),
  ]);
  const a = await scan();
  assert.equal(a.totals.sources.chatgpt, 2);
  assert.equal(a.totals.files["app.js"], 1);
});
test("live watcher tails new records and handles partial writes and truncation", (t) => {
  const { codex } = sandbox(t);
  const f = path.join(codex, "sessions/live.jsonl");
  const now = () => new Date().toISOString();
  jsonl(f, [
    {
      type: "session_meta",
      timestamp: now(),
      payload: { id: "live", cwd: "/private/work" },
    },
    { type: "turn_context", timestamp: now(), payload: { model: "gpt-5" } },
    { type: "event_msg", timestamp: now(), payload: { type: "task_started" } },
  ]);
  const watcher = new LogWatcher();
  watcher.poll();
  assert.equal(readJSON("state.json").status, "thinking");
  const line = JSON.stringify({
    type: "response_item",
    timestamp: now(),
    payload: { type: "function_call", name: "shell" },
  });
  fs.appendFileSync(f, line.slice(0, 20));
  watcher.poll();
  assert.equal(readJSON("state.json").status, "thinking");
  fs.appendFileSync(f, line.slice(20) + "\n");
  watcher.poll();
  assert.equal(readJSON("state.json").status, "working");
  assert.equal(readJSON("state.json").model, "gpt-5");
  jsonl(f, [
    { type: "event_msg", timestamp: now(), payload: { type: "task_complete" } },
  ]);
  watcher.poll();
  assert.equal(readJSON("state.json").status, "waiting");
});

test("modern token_usage_record wins over duplicate legacy counters and response IDs dedupe", async (t) => {
  const { codex } = sandbox(t);
  const f = jsonl(path.join(codex, "sessions/modern.jsonl"), [
    row("session_meta", { id: "modern" }),
    row("turn_context", { model: "o3" }),
    row("response_item", {
      type: "message",
      role: "user",
      id: "message1",
      content: [{ text: "hello" }],
    }),
    row(
      "token_usage_record",
      {
        response_id: "r1",
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          reasoning_output_tokens: 20,
        },
      },
      date(),
      1,
    ),
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            output_tokens: 100,
            reasoning_output_tokens: 20,
          },
        },
      },
      date(),
      1,
    ),
    row(
      "token_usage_record",
      {
        response_id: "r1",
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          reasoning_output_tokens: 20,
        },
      },
      date(),
      2,
    ),
    row("turn_context", { model: "gpt-5" }),
    row(
      "token_usage_record",
      {
        response_id: "r2",
        usage: {
          input_tokens: 2000,
          output_tokens: 200,
          reasoning_output_tokens: 50,
        },
      },
      date(),
      3,
    ),
    row(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 3000,
            output_tokens: 300,
            reasoning_output_tokens: 70,
          },
        },
      },
      date(),
      3,
    ),
  ]);
  const parsed = await parseFile(f);
  assert.equal(parsed.totals.tokens, 3300);
  assert.equal(parsed.totals.reasoning, 70);
  assert.equal(parsed.totals.prompts, 1);
  assert.ok(Math.abs(parsed.totals.cost - 0.0073) < 1e-12);
});
test("semantic prompt events suppress injected user response items and paused scans preserve totals", async (t) => {
  const { codex } = sandbox(t);
  jsonl(path.join(codex, "sessions/events.jsonl"), [
    row("session_meta", { id: "events" }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [{ text: "injected environment context" }],
    }),
    row(
      "event_msg",
      { type: "user_message", message: "actual prompt" },
      date(),
      1,
    ),
    row(
      "response_item",
      { type: "message", role: "user", content: [{ text: "actual prompt" }] },
      date(),
      1,
    ),
  ]);
  const a = await scan();
  assert.equal(a.totals.prompts, 1);
  writeJSON("config.json", { ...config(), enabled: false });
  const paused = await scan();
  assert.equal(paused.totals.prompts, 1);
});

test("history fallback counts distinct session IDs", async (t) => {
  const { codex } = sandbox(t);
  jsonl(path.join(codex, "history.jsonl"), [
    {
      session_id: "one",
      ts: Date.parse(date() + "T10:00:00Z") / 1000,
      text: "first",
    },
    {
      session_id: "two",
      ts: Date.parse(date() + "T10:01:00Z") / 1000,
      text: "second",
    },
  ]);
  const a = await scan();
  assert.equal(a.totals.sessions, 2);
  assert.equal(a.totals.prompts, 2);
});
test("ChatGPT observations accumulate foreground hours and sessions without invented tokens", async (t) => {
  sandbox(t);
  const { recordObservation } = await import("../src/chatgpt-detector.js");
  const now = Date.now();
  recordObservation({ running: true, foreground: true }, now);
  recordObservation({ running: true, foreground: true }, now + 5000);
  recordObservation({ running: true, foreground: false }, now + 10000);
  recordObservation({ running: true, foreground: null }, now + 15000);
  recordObservation({ running: false, foreground: false }, now + 20000);
  recordObservation({ running: true, foreground: true }, now + 25000);
  const a = await scan();
  assert.equal(a.totals.activeSeconds, 5);
  assert.equal(a.totals.sessions, 2);
  assert.equal(a.totals.tokens, 0);
  assert.equal(a.totals.sourceSessions.chatgpt, 2);
  assert.equal(a.totals.sourceHours.chatgpt, 5 / 3600);
  assert.equal(a.streak.current, 1);
});

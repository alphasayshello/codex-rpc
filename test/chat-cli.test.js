import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sandbox } from "./helpers.js";
import { writeJSON, config } from "../src/store.js";
import { emptyStats } from "../src/scanner.js";
import { renderChat, renderStatus } from "../src/tui.js";
import { completion } from "../src/completion.js";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/codex-rpc.js", import.meta.url));

test("chat CLI JSON reports selected conversation, never lifetime totals", async (t) => {
  const { env } = sandbox(t);
  writeJSON("state.json", { sessionId: "selected", source: "codex", model: "o3", status: "working" });
  writeJSON("aggregate.json", { totals: { ...emptyStats(), tokens: 999999 } });
  writeJSON("sessions.json", { updatedAt: Date.now(), sessions: {
    selected: { id: "selected", source: "codex", usageKnown: true,
      totals: { ...emptyStats(), tokens: 1234, input: 1000, output: 234, prompts: 2, toolCalls: 3 } },
    other: { id: "other", usageKnown: true, totals: { ...emptyStats(), tokens: 999999 } },
  } });
  const { stdout, stderr } = await exec(process.execPath, [cli, "chat", "--json"], { env });
  assert.equal(stderr, "");
  const chat = JSON.parse(stdout);
  assert.equal(chat.id, "selected");
  assert.equal(chat.tokens, 1234);
  assert.equal(chat.prompts, 2);
  assert.equal(chat.toolCalls, 3);
  assert.equal(chat.title, "Private conversation");
  writeJSON("state.json", { sessionId: "unknown", source: "codex" });
  const unknown = JSON.parse((await exec(process.execPath, [cli, "chat", "--json"], { env })).stdout);
  assert.equal(unknown.tokens, null);
  assert.equal(unknown.cost, null);
  assert.equal(unknown.prompts, null);
});

test("status separates current chat from lifetime, and usage stays lifetime-only", (t) => {
  sandbox(t);
  writeJSON("state.json", { sessionId: "selected", project: "secret-project", source: "codex", tokens: 200, usage: { input: 150, output: 50 } });
  const status = renderStatus();
  assert.match(status, /Current chat/);
  assert.match(status, /50 output tokens/);
  assert.match(status, /Lifetime totals/);
  assert.ok(!status.includes("secret-project"));
  assert.ok(!renderStatus({ usage: true, currentChat: false }).includes("Current chat"));
  for (const shell of ["bash", "zsh", "fish", "powershell"])
    assert.match(completion(shell), /\bchat\b/);
});

test("chat TUI names active tools and preserves unknown versus measured zero", (t) => {
  sandbox(t);
  const chat = { id: "selected", title: "Real title", tokens: 0, output: 0, prompts: 0,
    toolCalls: 2, activeTools: [{ name: "exec_command", callId: "1" }, { name: "exec_command", callId: "2" }],
    recentTools: [{ name: "apply_patch" }], contextPercent: 25, contextWindow: 1000, lastRequestTokens: 250,
  };
  const rendered = renderChat(chat, { ...config(), privacy: "public" });
  assert.match(rendered, /Real title/);
  assert.match(rendered, /0 output tokens · 0 prompts/);
  assert.match(rendered, /Active tools: exec_command\n/);
  assert.match(rendered, /Recent tools: apply_patch/);
  assert.match(rendered, /Context: 25\.0%/);
  assert.match(rendered, /API equivalent: unavailable/);
  assert.ok(!renderChat(chat).includes("Real title"));
  assert.match(renderChat({ id: null }), /No identified chat/);
});

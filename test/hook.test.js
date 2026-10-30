import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { sandbox } from "./helpers.js";
import { applyEvent, normalizeEvent } from "../src/hook.js";
import {
  readJSON,
  writeJSON,
  config,
  file,
  validateConfig,
} from "../src/store.js";
import { detectChatGPT, pollChatGPT } from "../src/chatgpt-detector.js";
const exec = promisify(execFile);
test("all lifecycle states, private persistence, tool cleanup and session timers", (t) => {
  sandbox(t);
  for (const [type, status] of [
    ["turn-start", "thinking"],
    ["tool-start", "working"],
    ["approval-request", "waiting"],
    ["session-end", "idle"],
  ]) {
    const result = applyEvent({
      type,
      cwd: "/secret/company",
      model: "o4-mini",
      tool: "bash",
      "thread-id": "s",
    });
    assert.equal(result.status, status);
    assert.equal(readJSON("state.json").status, status);
    assert.ok(!("project" in result));
    if (status !== "working") assert.ok(!result.tool);
  }
  assert.equal(
    normalizeEvent({ payload: { type: "function_call", name: "shell" } })
      .status,
    "working",
  );
  assert.equal(normalizeEvent({ type: "unknown" }), null);
});
test("public mode, stale-event ordering and kill switch", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  applyEvent({
    type: "working",
    cwd: "/work/widget",
    timestamp: "2026-10-29T10:00:00Z",
  });
  assert.equal(readJSON("state.json").project, "widget");
  applyEvent({ type: "idle", timestamp: "2026-10-28T10:00:00Z" });
  assert.equal(readJSON("state.json").status, "working");
  writeJSON("config.json", { ...config(), enabled: false });
  assert.equal(applyEvent({ type: "thinking" }), null);
  assert.equal(readJSON("state.json").status, "working");
});
test("ChatGPT foreground/background/closed transitions and Codex priority", (t) => {
  sandbox(t);
  for (const [type, state] of [
    ["app-active", "waiting"],
    ["app-background", "idle"],
    ["app-closed", "idle"],
  ]) {
    assert.equal(applyEvent({ type, source: "chatgpt" }).status, state);
  }
  applyEvent({ type: "tool-start", tool: "bash" });
  applyEvent({ type: "app-background", source: "chatgpt" });
  assert.equal(readJSON("state.json").source, "codex");
  applyEvent({ type: "agent-turn-complete" });
  assert.equal(readJSON("state.json").status, "waiting");
});
test("detector parses macOS and Windows process responses without reading chat", async (t) => {
  sandbox(t);
  const mac = await detectChatGPT({
    platform: "darwin",
    run: async () => ({ stdout: "ChatGPT, true" }),
  });
  assert.deepEqual([mac.running, mac.foreground], [true, true]);
  const windows = await detectChatGPT({
    platform: "win32",
    run: async () => ({ stdout: "1234" }),
  });
  assert.equal(windows.running, true);
  assert.equal(windows.foreground, null);
  const absent = await detectChatGPT({
    run: async () => {
      throw Object.assign(Error("no process"), { code: 1 });
    },
  });
  assert.equal(absent.running, false);
});
test("hook accepts argument and stdin; concurrent writes remain valid JSON", async (t) => {
  sandbox(t);
  const script = fileURLToPath(new URL("../src/hook.js", import.meta.url));
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      exec(process.execPath, [
        script,
        JSON.stringify({
          type: ["working", "thinking", "waiting", "idle"][i % 4],
        }),
      ]),
    ),
  );
  assert.ok(
    ["working", "thinking", "waiting", "idle"].includes(
      readJSON("state.json").status,
    ),
  );
  const result = await exec(process.execPath, [script, '{"type":"working"}']);
  assert.equal(result.stderr, "");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("stdin hook failed")),
    );
    child.stdin.end('{"type":"waiting"}\n');
  });
  assert.equal(readJSON("state.json").status, "waiting");
  assert.equal(
    fs.readdirSync(process.env.CODEX_RPC_HOME).filter((n) => n.endsWith(".tmp"))
      .length,
    0,
  );
});
test("config rejects dangerous or malformed options", (t) => {
  sandbox(t);
  for (const patch of [
    { privacy: "oops" },
    { assets: { working: "javascript:alert(1)" } },
    { timing: { pollMs: 1 } },
    { buttons: [{ label: "x", url: "file:///private" }] },
    { enabled: "false" },
    { assets: null },
    { stats: { enabled: "yes" } },
    { evil: true },
  ])
    assert.throws(() => validateConfig(patch));
  assert.equal(validateConfig({ privacy: "public" }).privacy, "public");
});

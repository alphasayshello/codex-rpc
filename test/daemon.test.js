import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sandbox, mockDiscord, until, jsonl } from "./helpers.js";
import { config, writeJSON, readJSON } from "../src/store.js";
const exec = promisify(execFile),
  cli = fileURLToPath(new URL("../bin/codex-rpc.js", import.meta.url));
test("daemon consumes a real live log, connects, clears on pause and reconnects on resume", async (t) => {
  const { temp, env, codex } = sandbox(t);
  const socket =
    process.platform === "win32"
      ? `\\\\?\\pipe\\codex-rpc-test-${process.pid}`
      : path.join(temp, "discord.sock");
  env.CODEX_RPC_IPC = socket;
  const old = process.env.CODEX_RPC_IPC;
  process.env.CODEX_RPC_IPC = socket;
  t.after(() => {
    if (old === undefined) delete process.env.CODEX_RPC_IPC;
    else process.env.CODEX_RPC_IPC = old;
  });
  const mock = await mockDiscord(t, socket);
  writeJSON("config.json", {
    ...config(),
    clientId: "12345678",
    presence: { ...config().presence, stats: "chat" },
    chatgpt: { enabled: false },
    stats: { enabled: false },
    assets: { working: "https://example.com/working.gif" },
    timing: { ...config().timing, pollMs: 1000 },
  });
  jsonl(path.join(codex, "sessions/live.jsonl"), [
    {
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: "live", cwd: "/secret/project" },
    },
    {
      type: "turn_context",
      timestamp: new Date().toISOString(),
      payload: { model: "gpt-5" },
    },
    {
      type: "response_item",
      timestamp: new Date().toISOString(),
      payload: {
        type: "function_call",
        name: "shell",
        arguments: '{"command":"echo private"}',
      },
    },
  ]);
  t.after(async () => {
    try {
      await exec(process.execPath, [cli, "stop"], { env });
    } catch {}
  });
  await exec(process.execPath, [cli, "start"], { env });
  await until(() =>
    mock.received.some(
      (x) =>
        x.args?.activity?.assets.large_image ===
        "https://example.com/working.gif",
    ),
  );
  const activity = mock.received.find((x) => x.args?.activity).args.activity;
  assert.equal(activity.assets.large_text, "Working with Bash");
  assert.equal(readJSON("state.json").model, "gpt-5");
  assert.ok(!JSON.stringify(activity).includes("secret"));
  assert.ok(!JSON.stringify(activity).includes("echo private"));
  await exec(process.execPath, [cli, "pause"], { env });
  await until(() => mock.received.some((x) => x.args?.activity === null));
  await until(() => readJSON("daemon.json").connected === false);
  const first = mock.handshakes;
  await exec(process.execPath, [cli, "resume"], { env });
  await until(() => mock.handshakes > first);
  await exec(process.execPath, [cli, "stop"], { env });
  assert.equal(readJSON("daemon.json").pid, null);
});

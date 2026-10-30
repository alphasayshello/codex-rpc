import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { sandbox, until } from "./helpers.js";
import {
  serviceDefinition,
  registerHook,
  unregisterHook,
} from "../src/service.js";
import { config, writeJSON, readJSON, alive } from "../src/store.js";
import { completion, commands } from "../src/completion.js";
const exec = promisify(execFile),
  cli = new URL("../bin/codex-rpc.js", import.meta.url).pathname;
test("all read-only commands exit cleanly and produce useful output", async (t) => {
  const { temp, env } = sandbox(t);
  writeJSON("config.json", { ...config(), chatgpt: { enabled: false } });
  for (const cmd of [
    "status",
    "usage",
    "insights",
    "doctor",
    "statcards",
    "help",
    "version",
    "scan",
  ]) {
    const args = [cli, cmd];
    if (cmd === "statcards") args.push("--output", path.join(temp, "cards"));
    const { stdout, stderr } = await exec(process.execPath, args, {
      env,
      timeout: 10000,
    });
    assert.ok(stdout.trim(), cmd);
    assert.equal(stderr, "", cmd);
  }
  await assert.rejects(
    exec(process.execPath, [cli, "no-such-command"], { env }),
  );
  for (const shell of ["bash", "zsh", "fish", "powershell"])
    for (const command of commands)
      assert.ok(completion(shell).includes(command));
});
test("setup installs a stable runtime and idempotent top-level notify without changing existing tables", async (t) => {
  const { codex, env, rpc } = sandbox(t);
  fs.writeFileSync(
    path.join(codex, "config.toml"),
    'model = "gpt-5"\n[tui]\nnotifications = true\n',
  );
  await exec(process.execPath, [cli, "setup", "--no-service", "--no-start"], {
    env,
  });
  assert.ok(fs.existsSync(path.join(rpc, "runtime/bin/codex-rpc.js")));
  let text = fs.readFileSync(path.join(codex, "config.toml"), "utf8");
  assert.ok(text.indexOf("notify =") < text.indexOf("[tui]"));
  assert.match(text, /notifications = true/);
  registerHook();
  text = fs.readFileSync(path.join(codex, "config.toml"), "utf8");
  assert.equal((text.match(/notify =/g) || []).length, 1);
  unregisterHook();
  assert.equal(
    fs.readFileSync(path.join(codex, "config.toml"), "utf8"),
    'model = "gpt-5"\n[tui]\nnotifications = true\n',
  );
  fs.writeFileSync(
    path.join(codex, "config.toml"),
    'notify = ["my-notifier"]\n',
  );
  assert.throws(registerHook, /Existing Codex notify/);
  assert.equal(
    fs.readFileSync(path.join(codex, "config.toml"), "utf8"),
    'notify = ["my-notifier"]\n',
  );
});
test("service descriptors cover macOS, Linux and Windows and retain separate homes", (t) => {
  sandbox(t);
  assert.match(serviceDefinition("darwin").content, /<plist/);
  assert.match(serviceDefinition("darwin").content, /CODEX_HOME/);
  assert.match(serviceDefinition("linux").content, /\[Service\]/);
  assert.match(serviceDefinition("win32").content, /start "" \/min/);
});
test("daemon CLI start/status/pause/resume/restart/stop stays within sandbox", async (t) => {
  const { env } = sandbox(t);
  writeJSON("config.json", {
    ...config(),
    chatgpt: { enabled: false },
    stats: { enabled: false },
  });
  t.after(async () => {
    try {
      await exec(process.execPath, [cli, "stop"], { env, timeout: 10000 });
    } catch {}
  });
  await exec(process.execPath, [cli, "start"], { env, timeout: 10000 });
  const first = readJSON("daemon.json").pid;
  assert.ok(alive(first));
  await exec(process.execPath, [cli, "pause"], { env });
  assert.equal(config().enabled, false);
  await exec(process.execPath, [cli, "resume"], { env });
  assert.equal(config().enabled, true);
  await exec(process.execPath, [cli, "restart"], { env, timeout: 10000 });
  assert.notEqual(readJSON("daemon.json").pid, first);
  await exec(process.execPath, [cli, "stop"], { env, timeout: 10000 });
  assert.equal(readJSON("daemon.json").pid, null);
});

test("completion install writes and idempotently registers all shell scripts in a disposable HOME", async (t) => {
  const { temp, env } = sandbox(t);
  for (const shell of ["bash", "zsh", "fish"]) {
    await exec(process.execPath, [cli, "completion", "install", shell], {
      env,
    });
    await exec(process.execPath, [cli, "completion", "install", shell], {
      env,
    });
    const profile = path.join(
      temp,
      shell === "fish" ? ".config/fish/config.fish" : "." + shell + "rc",
    );
    assert.equal(
      (
        fs
          .readFileSync(profile, "utf8")
          .match(/# codex-rpc completion begin/g) || []
      ).length,
      1,
    );
  }
  const { stdout } = await exec(
    process.execPath,
    [cli, "completion", "powershell"],
    { env },
  );
  assert.match(stdout, /Register-ArgumentCompleter/);
});

test('Codex wrapper forwards arguments and records session end',async t=>{const {env}=sandbox(t);env.CODEX_RPC_CODEX_BIN=process.execPath;const {stdout}=await exec(process.execPath,[cli,'run','--','--version'],{env});assert.match(stdout,/v\d+/);assert.equal(readJSON('state.json').status,'idle');});

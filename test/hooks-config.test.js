import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sandbox } from "./helpers.js";
import { config, writeJSON } from "../src/store.js";
import { lifecycleEvents, lifecycleCommands, installLifecycleHooks, removeLifecycleHooks, inspectLifecycleHooks, stripLifecycleHooks } from "../src/hooks-config.js";
import { registerHook, unregisterHook, setup } from "../src/service.js";
import { doctor } from "../src/doctor.js";
const nativeBegin = "# codex-rpc lifecycle hooks begin", nativeEnd = "# codex-rpc lifecycle hooks end";

test("ten native hooks append safely beside existing inline hooks, notify and hooks.json", (t) => {
  const { codex, rpc } = sandbox(t), target = path.join(codex, "config.toml");
  const original = 'notify = ["SkyComputerUseClient", "turn-ended"]\nmodel = "gpt-5"\n\n[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "custom-check"\n[features]\nhooks = false\n';
  const hooksJSON = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing-hook"}]}]}}\n';
  fs.writeFileSync(target, original); fs.writeFileSync(path.join(codex, "hooks.json"), hooksJSON);
  const report = installLifecycleHooks();
  const installed = fs.readFileSync(target, "utf8");
  assert.equal(report.configured, true);
  assert.equal(report.eventCount, 10);
  assert.deepEqual(report.events, lifecycleEvents);
  assert.equal(report.trust, "unknown");
  assert.equal(report.reviewRequired, true);
  assert.equal(report.featuresEnabled, false);
  assert.match(report.guidance, /\/hooks.*review and trust/);
  assert.equal(report.sources.length, 3);
  assert.match(report.warning, /merges inline hooks and hooks.json/);
  assert.equal(report.legacyNotify.configured, true);
  assert.equal(report.legacyNotify.owned, false);
  assert.ok(installed.startsWith(original));
  assert.equal(stripLifecycleHooks(installed), original);
  assert.equal((installed.match(/^timeout = 3$/gm) || []).length, 10);
  assert.ok(!installed.includes("async = true"));
  assert.ok(!installed.includes("dangerously-bypass"));
  assert.equal(fs.readFileSync(path.join(codex, "hooks.json"), "utf8"), hooksJSON);
  assert.equal(fs.readFileSync(path.join(rpc, "codex-config.backup.toml"), "utf8"), original);
  installLifecycleHooks(); assert.equal(fs.readFileSync(target, "utf8"), installed);
  unregisterHook(); assert.equal(fs.readFileSync(target, "utf8"), original);
});
test("owned registration preserves byte layout and first backup across upgrades", (t) => {
  const { codex, rpc } = sandbox(t), target = path.join(codex, "config.toml");
  for (const original of ['model = "gpt-5"', 'model = "gpt-5"\n', 'model = "gpt-5"\r\n[tui]\r\nnotifications = true\r\n']) {
    fs.writeFileSync(target, original);
    installLifecycleHooks(); installLifecycleHooks(); removeLifecycleHooks();
    assert.equal(fs.readFileSync(target, "utf8"), original);
  }
  assert.equal(fs.readFileSync(path.join(rpc, "codex-config.backup.toml"), "utf8"), 'model = "gpt-5"');
  assert.ok(!fs.readdirSync(codex).some((name) => name.endsWith(".tmp")));
});
test("malformed or foreign-content marker blocks never consume user configuration", (t) => {
  const { codex, rpc } = sandbox(t), target = path.join(codex, "config.toml");
  for (const value of [
    nativeBegin + '\nmodel = "private"\n',
    nativeEnd + "\n" + nativeBegin + "\n",
    nativeBegin + '\n[foreign]\nsecret = "keep"\n' + nativeEnd + "\n",
    nativeBegin + '\n[[hooks.Stop]]\n' + nativeEnd + "\n",
    nativeBegin + "\n" + nativeEnd + "\n" + nativeBegin + "\n" + nativeEnd,
  ]) {
    fs.writeFileSync(target, value);
    assert.throws(installLifecycleHooks, /preserved|markers/);
    assert.throws(removeLifecycleHooks, /preserved|markers/);
    assert.equal(fs.readFileSync(target, "utf8"), value);
    const report = inspectLifecycleHooks();
    assert.equal(report.configured, false); assert.ok(report.errors.length);
  }
  assert.equal(fs.existsSync(path.join(rpc, "codex-config.backup.toml")), false);
});
test("marker-looking strings and fixed-value hook tables are preserved", (t) => {
  const { codex } = sandbox(t), target = path.join(codex, "config.toml");
  const stringConfig = `description = '''\n${nativeBegin}\nnot a hook\n${nativeEnd}\n'''\n`;
  fs.writeFileSync(target, stringConfig);
  installLifecycleHooks(); removeLifecycleHooks();
  assert.equal(fs.readFileSync(target, "utf8"), stringConfig);
  for (const value of ['hooks = { Stop = [] }\n', '"hooks" = { Stop = [] }\n', '[hooks]\nStop = []\n', '["hooks"]\n"Stop" = []\n', '[hooks.PreToolUse]\ncommand = "custom"\n', '["hooks"."PreToolUse"]\ncommand = "custom"\n']) {
    fs.writeFileSync(target, value);
    assert.throws(installLifecycleHooks, /cannot be extended safely/);
    assert.equal(fs.readFileSync(target, "utf8"), value);
  }
});
test("POSIX hook quoting forwards stdin and exact paths without executing metacharacters", { skip: process.platform === "win32" }, (t) => {
  const { temp } = sandbox(t);
  process.env.CODEX_RPC_HOME = path.join(temp, "rpc ' & $value % !");
  process.env.CODEX_HOME = path.join(temp, "codex ' & $value % !");
  const entry = path.join(temp, "callback ' & $literal %.mjs");
  fs.writeFileSync(entry, 'let text="";for await(const part of process.stdin)text+=part;console.log(JSON.stringify({argv:process.argv.slice(2),home:process.env.CODEX_RPC_HOME,codex:process.env.CODEX_HOME,input:JSON.parse(text)}));');
  const { command } = lifecycleCommands({ executable: process.execPath, entry });
  const result = JSON.parse(execFileSync("sh", ["-c", command], { encoding: "utf8", input: '{"hook_event_name":"PreToolUse","session_id":"test"}' }));
  assert.deepEqual(result.argv, ["hook"]);
  assert.equal(result.home, process.env.CODEX_RPC_HOME);
  assert.equal(result.codex, process.env.CODEX_HOME);
  assert.equal(result.input.hook_event_name, "PreToolUse");
});
test("Windows hook commands use explicit encoded PowerShell without outer-shell assumptions", (t) => {
  sandbox(t);
  const executable = "C:\\Node & O'Brien %TEMP% !\\codex-rpc.exe", entry = "C:\\RPC & O'Brien\\runtime\\bin\\codex-rpc.js";
  const { commandWindows } = lifecycleCommands({ executable, entry });
  assert.match(commandWindows, /^powershell\.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand [A-Za-z0-9+/=]+$/);
  const script = Buffer.from(commandWindows.split(" ").at(-1), "base64").toString("utf16le");
  assert.ok(script.includes("& 'C:\\Node & O''Brien %TEMP% !\\codex-rpc.exe' 'C:\\RPC & O''Brien\\runtime\\bin\\codex-rpc.js' 'hook'"));
  assert.ok(script.includes("exit $LASTEXITCODE"));
  assert.ok(!commandWindows.includes("ExecutionPolicy"));
  assert.throws(() => lifecycleCommands({ executable: "node\nunsafe", entry }), /control characters/);
});
test("setup installs native hooks while preserving a custom notifier and diagnostics show trust unknown", async (t) => {
  const { codex, rpc } = sandbox(t), target = path.join(codex, "config.toml");
  const original = 'notify = ["SkyComputerUseClient", "turn-ended"]\n';
  fs.writeFileSync(target, original);
  writeJSON("config.json", { ...config(), clientId: "", chatgpt: { enabled: false } });
  const result = await setup({ noService: true, noStart: true });
  assert.match(result.hook, /Existing Codex notify is preserved/);
  assert.equal(result.lifecycle.configured, true);
  assert.equal(result.lifecycle.trust, "unknown");
  assert.ok(fs.readFileSync(target, "utf8").startsWith(original));
  const row = (await doctor()).find((row) => row.name === "Codex lifecycle hooks");
  assert.equal(row.ok, true); assert.match(row.hint, /trust unknown.*\/hooks/);
  assert.match((await doctor()).find((row) => row.name === "Codex notify").hint, /Custom notify preserved/);
  assert.equal(fs.readFileSync(path.join(rpc, "codex-config.backup.toml"), "utf8"), original);
  unregisterHook(); assert.equal(fs.readFileSync(target, "utf8"), original);
});
test("legacy notify registration API stays intact alongside lifecycle ownership", (t) => {
  const { codex } = sandbox(t);
  const line = registerHook(); assert.match(line, /^notify = /);
  installLifecycleHooks();
  assert.equal(inspectLifecycleHooks().legacyNotify.owned, true);
  unregisterHook();
  assert.equal(fs.readFileSync(path.join(codex, "config.toml"), "utf8"), "");
});
test("native Windows encoded lifecycle command forwards JSON stdin to Node", { skip: process.platform !== "win32", timeout: 15000 }, (t) => {
  const { temp } = sandbox(t), entry = path.join(temp, "hook callback ' & percent %.mjs");
  fs.writeFileSync(entry, 'let text="";for await(const part of process.stdin)text+=part;console.log(JSON.stringify({argv:process.argv.slice(2),input:JSON.parse(text)}));');
  const { commandWindows } = lifecycleCommands({ executable: process.execPath, entry });
  const [command, ...args] = commandWindows.split(" ");
  const actual = JSON.parse(execFileSync(command, args, { encoding: "utf8", input: '{"hook_event_name":"PreToolUse","session_id":"windows-native"}', timeout: 10000, windowsHide: true }));
  assert.deepEqual(actual.argv, ["hook"]);
  assert.equal(actual.input.hook_event_name, "PreToolUse");
  assert.equal(actual.input.session_id, "windows-native");
});

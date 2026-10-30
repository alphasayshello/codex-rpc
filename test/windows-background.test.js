import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sandbox } from "./helpers.js";
import { serviceDefinition, installService, removeService, startDaemon, runtimeExecutable } from "../src/service.js";
import { detectChatGPT, backgroundExecOptions } from "../src/chatgpt-detector.js";
import { startScanner } from "../src/daemon.js";
import { installCompletion } from "../src/completion.js";
import { writeJSON, home, codexHome } from "../src/store.js";

function decode(definition) {
  const encoded = definition.content.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(encoded);
  return Buffer.from(encoded, "base64").toString("utf16le");
}
function psValue(script, field) {
  const literal = script.split("\r\n").find((line) => line.startsWith(field + " = ")).slice(field.length + 3);
  assert.equal(literal[0], "'");
  assert.equal(literal.at(-1), "'");
  return literal.slice(1, -1).replaceAll("''", "'");
}
// Simulate CommandLineToArgvW/MS CRT double-quote/backslash rules; no shell or
// host-native Windows process is invoked by these deterministic tests.
function argvWindows(text) {
  const args = [];
  let arg = "", quoted = false, index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index]) && !quoted) { args.push(arg); arg = ""; while (/\s/.test(text[++index] || "") && index < text.length) {} continue; }
    let slashes = 0;
    while (text[index] === "\\") { slashes++; index++; }
    if (text[index] === '"') {
      arg += "\\".repeat(Math.floor(slashes / 2));
      if (slashes % 2) arg += '"'; else quoted = !quoted;
      index++;
    } else {
      arg += "\\".repeat(slashes);
      if (index < text.length) arg += text[index++];
    }
  }
  args.push(arg);
  return args;
}
test("Windows startup uses hidden encoded launch with literal metacharacter paths", (t) => {
  const { temp } = sandbox(t);
  process.env.CODEX_RPC_HOME = path.join(temp, "O'Brien & ! %PATH% ^ (é) \"quoted\" \\");
  process.env.CODEX_HOME = path.join(temp, "Codex %USERNAME% & ! 'é'");
  const executable = 'C:\\Program Files\\Node & %TEMP% ! (x)\\node.exe';
  const definition = serviceDefinition("win32", { executable });
  assert.match(definition.path, /codex-rpc\.vbs$/);
  assert.match(definition.content, /shell\.Run ".*", 0, False/);
  assert.doesNotMatch(definition.content, /cmd\.exe|start ""|%PATH%|%USERNAME%/);
  const script = decode(definition);
  assert.equal(psValue(script, "$env:CODEX_RPC_HOME"), home());
  assert.equal(psValue(script, "$env:CODEX_HOME"), codexHome());
  assert.equal(psValue(script, "$start.FileName"), executable);
  assert.deepEqual(argvWindows(psValue(script, "$start.Arguments")), [path.join(home(), "runtime/bin/codex-rpc.js"), "daemon"]);
  assert.match(script, /UseShellExecute = \$false/);
  assert.match(script, /CreateNoWindow = \$true/);
  assert.match(script, /ProcessWindowStyle\]::Hidden/);
});
test("setup migrates only owned legacy Startup cmd and uninstall removes hidden launcher", (t) => {
  const { temp } = sandbox(t);
  const definition = { ...serviceDefinition("win32"), path: path.join(temp, "Startup/codex-rpc.vbs"), legacyPath: path.join(temp, "Startup/codex-rpc.cmd") };
  fs.mkdirSync(path.dirname(definition.path), { recursive: true });
  const owned = '@echo off\r\nset "CODEX_RPC_HOME=C:\\rpc"\r\nstart "" /min "node.exe" "C:\\rpc\\runtime\\bin\\codex-rpc.js" "daemon"\r\n';
  fs.writeFileSync(definition.legacyPath, owned);
  assert.equal(installService({ platform: "win32", definition, verifyScriptHost: false }).warning, undefined);
  assert.equal(fs.existsSync(definition.legacyPath), false);
  assert.equal(fs.readFileSync(definition.path, "utf8"), definition.content);
  fs.writeFileSync(definition.legacyPath, "@echo off\r\necho custom launcher\r\n");
  assert.match(installService({ platform: "win32", definition, verifyScriptHost: false }).warning, /preserved/);
  removeService({ platform: "win32", definition });
  assert.equal(fs.existsSync(definition.path), false);
  assert.equal(fs.existsSync(definition.legacyPath), true);
  fs.writeFileSync(definition.legacyPath, owned);
  removeService({ platform: "win32", definition });
  assert.equal(fs.existsSync(definition.legacyPath), false);
});
test("daemon spawn and short-lived scanner fork suppress child console windows", async (t) => {
  sandbox(t);
  let launched;
  const state = await startDaemon({
    launch: (command, args, options) => {
      launched = { command, args, options };
      writeJSON("daemon.json", { pid: 42424242 });
      const child = new EventEmitter(); child.unref = () => {}; return child;
    }, isAlive: (pid) => pid === 42424242, sleep: async () => {},
  });
  assert.equal(state.pid, 42424242);
  assert.equal(launched.options.windowsHide, true);
  assert.equal(launched.options.detached, true);
  assert.equal(launched.options.stdio, "ignore");
  assert.equal(launched.options.shell, undefined);
  let scanned;
  startScanner((module, args, options) => { scanned = { module, args, options }; });
  assert.match(scanned.module, /scanner\.js$/);
  assert.deepEqual(scanned.args, ["--live"]);
  assert.equal(scanned.options.windowsHide, true);
  assert.equal(scanned.options.stdio, "ignore");
});
test("process detection and PowerShell completion profile queries are hidden", async (t) => {
  const { temp } = sandbox(t), calls = [];
  const detection = await detectChatGPT({ platform: "win32", run: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: "42" }; } });
  assert.equal(detection.running, true);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].args.includes("-NonInteractive"));
  const profile = path.join(temp, "PowerShell/profile.ps1");
  installCompletion("powershell", { run: (command, args, options) => { calls.push({ command, args, options }); return profile; } });
  assert.equal(calls[1].options.windowsHide, true);
  assert.match(fs.readFileSync(profile, "utf8"), /codex-rpc completion begin/);
});
test("Windows SEA startup selects installed executable and preserves script dispatch", (t) => {
  sandbox(t);
  const previous = process.env.CODEX_RPC_SEA;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_RPC_SEA; else process.env.CODEX_RPC_SEA = previous; });
  process.env.CODEX_RPC_SEA = "1";
  fs.mkdirSync(path.join(home(), "bin"), { recursive: true });
  const executable = path.join(home(), "bin/codex-rpc.exe");
  fs.writeFileSync(executable, "SEA placeholder; never executed");
  assert.equal(runtimeExecutable("win32"), executable);
  const script = decode(serviceDefinition("win32"));
  assert.equal(psValue(script, "$start.FileName"), executable);
  assert.deepEqual(argvWindows(psValue(script, "$start.Arguments")), [path.join(home(), "runtime/bin/codex-rpc.js"), "daemon"]);
});

test("native Windows detector options launch PowerShell without a visible console", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  const script = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodexRpcConsoleProbe {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
$handle = [CodexRpcConsoleProbe]::GetConsoleWindow()
[pscustomobject]@{ handle = $handle.ToInt64(); visible = [CodexRpcConsoleProbe]::IsWindowVisible($handle) } | ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], backgroundExecOptions(15000));
  const probe = JSON.parse(stdout.trim());
  assert.equal(typeof probe.handle, "number");
  assert.equal(probe.visible, false);
});

test("Windows setup reports disabled script engine without weakening policy or running service", (t) => {
  const { temp } = sandbox(t);
  const definition = { ...serviceDefinition("win32"), path: path.join(temp, "Startup/codex-rpc.vbs"), legacyPath: path.join(temp, "Startup/codex-rpc.cmd") };
  let probe;
  const result = installService({ platform: "win32", definition, verifyScriptHost: true,
    run: (command, args, options) => {
      assert.equal(command, "cscript.exe");
      assert.deepEqual(args.slice(0, 2), ["//B", "//Nologo"]);
      assert.equal(options.windowsHide, true);
      probe = args[2];
      assert.equal(fs.readFileSync(probe, "utf8"), "WScript.Quit 0\r\n");
      throw new Error("Script engine disabled by policy");
    },
  });
  assert.match(result.warning, /Windows Script Host.*unavailable or disabled/);
  assert.match(result.warning, /codex-rpc start manually/);
  assert.equal(fs.existsSync(probe), false);
  assert.equal(fs.existsSync(definition.path), true);
});

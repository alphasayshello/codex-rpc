import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox } from "./helpers.js";
import { registerHook, unregisterHook, installService } from "../src/service.js";
import { defaultShell, completionSource } from "../src/completion.js";
import { config, defaults, writeJSON } from "../src/store.js";
import { doctor } from "../src/doctor.js";

test("hook preserves independent notifiers even when they mention codex-rpc", (t) => {
  const { codex, rpc } = sandbox(t);
  fs.mkdirSync(rpc, { recursive: true });
  const target = path.join(codex, "config.toml");
  for (const text of [
    '# codex-rpc project\nnotify = ["my-notifier"]\n',
    'notify = ["/projects/codex-rpc/independent-notifier"]\n',
    '# codex-rpc notify begin\nnotify = ["codex-rpc", "hook"]\n# codex-rpc notify end\nnotify = ["second-notifier"]\n',
  ]) {
    fs.writeFileSync(target, text);
    assert.throws(registerHook, /Existing Codex notify/);
    assert.equal(fs.readFileSync(target, "utf8"), text);
  }
});

test("CRLF managed hooks upgrade and uninstall without duplicate TOML keys", (t) => {
  const { codex, rpc } = sandbox(t);
  fs.mkdirSync(rpc, { recursive: true });
  const target = path.join(codex, "config.toml");
  const untouched = 'model = "gpt-5"\r\n[tui]\r\nnotifications = true\r\n';
  fs.writeFileSync(target, '# codex-rpc notify begin\r\nnotify = ["old-codex-rpc", "hook"]\r\n# codex-rpc notify end\r\n' + untouched);
  registerHook();
  registerHook();
  assert.equal((fs.readFileSync(target, "utf8").match(/^notify =/gm) || []).length, 1);
  assert.deepEqual(fs.readdirSync(codex), ["config.toml"]);
  unregisterHook();
  assert.equal(fs.readFileSync(target, "utf8"), untouched);
});

test("macOS service reinstall unloads cached agent and reloads new descriptor", (t) => {
  const { temp } = sandbox(t);
  const definition = { path: path.join(temp, "agents/test.plist"), content: "updated descriptor" };
  const calls = [];
  const result = installService({ platform: "darwin", definition, uid: 501,
    run: (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "bootout") throw new Error("Agent not loaded");
    },
  });
  assert.equal(result.warning, undefined);
  assert.equal(fs.readFileSync(definition.path, "utf8"), definition.content);
  assert.deepEqual(calls, [
    ["launchctl", "bootout", "gui/501/dev.codex-rpc"],
    ["launchctl", "bootstrap", "gui/501", definition.path],
  ]);
});

test("service installation exposes registration failures with a fixable warning", (t) => {
  const { temp } = sandbox(t);
  const result = installService({ platform: "linux",
    definition: { path: path.join(temp, "service"), content: "unit" },
    run: () => { throw new Error("No user bus"); },
  });
  assert.match(result.warning, /No user bus/);
});

test("shell completion defaults and quoting respect native Windows and POSIX paths", () => {
  assert.equal(defaultShell("win32", ""), "powershell");
  assert.equal(defaultShell("linux", ""), "bash");
  assert.equal(defaultShell("win32", "C:\\Program Files\\Git\\bin\\bash"), "bash");
  assert.equal(defaultShell("win32", "C:\\Program Files\\Git\\bin\\bash.exe"), "bash");
  assert.equal(defaultShell("win32", "C:\\Program Files\\PowerShell\\pwsh.exe"), "powershell");
  assert.equal(completionSource("powershell", "C:\\O'Brien\\rpc.ps1", "win32"), ". 'C:\\O''Brien\\rpc.ps1'");
  assert.equal(completionSource("bash", "C:\\O'Brien\\rpc.bash", "win32"), "source 'C:/O'\\''Brien/rpc.bash'");
  assert.equal(completionSource("fish", "C:\\O'Brien\\rpc.fish", "win32"), "source 'C:/O\\'Brien/rpc.fish'");
  assert.equal(completionSource("bash", "/tmp/back\\slash/file", "linux"), "source '/tmp/back\\slash/file'");
});

test("defaults include registered Discord application and hosted animated mascot", () => {
  assert.equal(defaults.clientId, "1565535814308470814");
  for (const state of ["working", "thinking", "waiting", "idle"])
    assert.match(defaults.assets[state], new RegExp(`^https://raw\\.githubusercontent\\.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-${state}\\.gif`));
});

test("doctor accepts intentional public privacy and explains invalid config", async (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), clientId: "", privacy: "public", chatgpt: { enabled: false } });
  assert.equal((await doctor()).find((row) => row.name === "Privacy/config").ok, true);
  writeJSON("config.json", { ...config(), privacy: "invalid" });
  const privacy = (await doctor()).find((row) => row.name === "Privacy/config");
  assert.equal(privacy.ok, false);
  assert.match(privacy.hint, /privacy must be/);
});

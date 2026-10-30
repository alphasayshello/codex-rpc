import fs from "node:fs";
import { replaceFile } from "./atomic.js";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  home,
  defaults,
  file,
  codexHome,
  readJSON,
  writeJSON,
  config,
  alive,
  xml,
} from "./store.js";
import { uninstallCompletions } from "./completion.js";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const runtimeExecutable = (platform = process.platform) =>
  process.env.CODEX_RPC_SEA &&
  fs.existsSync(
    path.join(
      home(),
      "bin",
      platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
    ),
  )
    ? path.join(
        home(),
        "bin",
        platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
      )
    : process.execPath;
const cli = () => path.join(home(), "runtime/bin/codex-rpc.js");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const hookBlock = /^# codex-rpc notify begin\r?\n[\s\S]*?^# codex-rpc notify end\r?\n?/gm;
export function registerHook() {
  fs.mkdirSync(codexHome(), { recursive: true, mode: 0o700 });
  const target = path.join(codexHome(), "config.toml");
  let text = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const line = `notify = ${JSON.stringify([runtimeExecutable(), cli(), "hook"])}`;
  const clean = text.replace(hookBlock, "");
  const top = clean.split(/^\s*\[/m)[0];
  if (/^\s*notify\s*=/m.test(top))
    throw Error(
      "Existing Codex notify is preserved. Chain codex-rpc hook yourself or use codex-rpc run -- <args>.",
    );
  if (!fs.existsSync(file("codex-config.backup.toml")))
    fs.writeFileSync(file("codex-config.backup.toml"), text, { mode: 0o600 });
  text = clean;
  const block = `# codex-rpc notify begin\n${line}\n# codex-rpc notify end\n`;
  const temp = target + `.codex-rpc.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, block + text, { mode: 0o600 });
    replaceFile(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return line;
}
export function unregisterHook() {
  const target = path.join(codexHome(), "config.toml");
  if (fs.existsSync(target)) {
    const text = fs
      .readFileSync(target, "utf8")
      .replace(hookBlock, "");
    fs.writeFileSync(target, text, { mode: 0o600 });
  }
}
export function serviceDefinition(platform = process.platform, { executable = runtimeExecutable(platform) } = {}) {
  const node = executable,
    command = [node, cli(), "daemon"];
  if (platform === "darwin")
    return {
      path: path.join(os.homedir(), "Library/LaunchAgents/dev.codex-rpc.plist"),
      content: `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>dev.codex-rpc</string><key>ProgramArguments</key><array>${command.map((s) => `<string>${xml(s)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>CODEX_RPC_HOME</key><string>${xml(home())}</string><key>CODEX_HOME</key><string>${xml(codexHome())}</string></dict><key>RunAtLoad</key><true/></dict></plist>`,
    };
  if (platform === "linux") {
    const q = (s) =>
      '"' + s.replace(/[\\"%]/g, (x) => (x === "%" ? "%%" : "\\" + x)) + '"';
    return {
      path: path.join(os.homedir(), ".config/systemd/user/codex-rpc.service"),
      content: `[Unit]\nDescription=Codex Discord presence\n[Service]\nExecStart=${command.map(q).join(" ")}\nEnvironment=${q("CODEX_RPC_HOME=" + home())}\nEnvironment=${q("CODEX_HOME=" + codexHome())}\nRestart=on-failure\nRestartSec=5\n[Install]\nWantedBy=default.target\n`,
    };
  }
  if (platform === "win32") {
    // No cmd.exe or batch expansion: paths containing &, !, %, quotes or
    // spaces are literals inside an encoded PowerShell ProcessStartInfo script.
    // WScript hides PowerShell, which creates Node without a console window.
    const ps = (value) => "'" + value.replaceAll("'", "''") + "'";
    const quoteArgument = (value) => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
    const script = [
      `$env:CODEX_RPC_HOME = ${ps(home())}`,
      `$env:CODEX_HOME = ${ps(codexHome())}`,
      "$start = New-Object System.Diagnostics.ProcessStartInfo",
      `$start.FileName = ${ps(node)}`,
      `$start.Arguments = ${ps(command.slice(1).map(quoteArgument).join(" "))}`,
      "$start.UseShellExecute = $false",
      "$start.CreateNoWindow = $true",
      "$start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden",
      "[System.Diagnostics.Process]::Start($start) | Out-Null",
    ].join("\r\n");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const directory = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming"),
      "Microsoft/Windows/Start Menu/Programs/Startup",
    );
    return {
      path: path.join(directory, "codex-rpc.vbs"),
      legacyPath: path.join(directory, "codex-rpc.cmd"),
      content: `' codex-rpc hidden startup v1\r\nOption Explicit\r\nDim shell\r\nSet shell = CreateObject("WScript.Shell")\r\nshell.Run "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}", 0, False\r\n`,
    };
  }
  throw Error("Unsupported service platform");
}
export function installService({
  platform = process.platform,
  definition = serviceDefinition(platform),
  run = execFileSync,
  uid = process.getuid?.() ?? 0,
  verifyScriptHost = platform === "win32" && process.platform === "win32",
} = {}) {
  const d = definition;
  fs.mkdirSync(path.dirname(d.path), { recursive: true });
  fs.writeFileSync(d.path, d.content, { mode: 0o600 });
  let warning;
  if (platform === "win32") {
    warning = removeLegacyStartup(d.legacyPath);
    if (verifyScriptHost) {
      fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
      const probe = file(`script-host-probe-${randomUUID()}.vbs`);
      try {
        fs.writeFileSync(probe, "WScript.Quit 0\r\n", { mode: 0o600 });
        run("cscript.exe", ["//B", "//Nologo", probe], { stdio: "pipe", timeout: 5000, windowsHide: true });
      } catch (e) {
        warning = [warning, "Windows autostart requires Windows Script Host with VBScript support, which is unavailable or disabled. Use codex-rpc start manually; check Windows optional features or your administrator's script policy. " + e.message].filter(Boolean).join(" ");
      } finally {
        fs.rmSync(probe, { force: true });
      }
    }
  }
  try {
    if (platform === "darwin") {
      // Refresh an already loaded agent, whose cached arguments/environment
      // otherwise survive a setup upgrade. Missing agents are harmless.
      try {
        run("launchctl", ["bootout", `gui/${uid}/dev.codex-rpc`], {
          stdio: "pipe", windowsHide: true,
        });
      } catch {}
      run(
        "launchctl",
        ["bootstrap", `gui/${uid}`, d.path],
        { stdio: "pipe", windowsHide: true },
      );
    }
    if (platform === "linux") {
      run("systemctl", ["--user", "daemon-reload"], { stdio: "pipe", windowsHide: true });
      run("systemctl", ["--user", "enable", "codex-rpc.service"], {
        stdio: "pipe", windowsHide: true,
      });
    }
  } catch (e) {
    warning = `Autostart registration needs attention: ${e.message}`;
  }
  return { path: d.path, warning };
}
function removeLegacyStartup(target) {
  if (!target || !fs.existsSync(target)) return;
  const text = fs.readFileSync(target, "utf8");
  if (/^@echo off\r?\n/i.test(text) && text.includes("CODEX_RPC_HOME=") &&
    text.includes('start "" /min') && /codex-rpc/.test(text) && /daemon/.test(text)) {
    fs.rmSync(target, { force: true });
  } else return "Existing Startup codex-rpc.cmd was preserved because it is not a recognized codex-rpc launcher.";
}
export function removeService({ platform = process.platform, definition = serviceDefinition(platform), run = execFileSync } = {}) {
  const d = definition;
  try {
    if (platform === "darwin")
      run(
        "launchctl",
        ["bootout", `gui/${process.getuid()}/dev.codex-rpc`],
        { stdio: "pipe", windowsHide: true },
      );
    if (platform === "linux")
      run(
        "systemctl",
        ["--user", "disable", "--now", "codex-rpc.service"],
        { stdio: "pipe", windowsHide: true },
      );
  } catch {}
  fs.rmSync(d.path, { force: true });
  if (platform === "win32") removeLegacyStartup(d.legacyPath);
}
export async function startDaemon({ launch = spawn, isAlive = alive, sleep = delay } = {}) {
  const old = readJSON("daemon.json");
  if (isAlive(old.pid)) return old;
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const entry = fs.existsSync(cli())
    ? cli()
    : path.join(root, "bin/codex-rpc.js");
  const child = launch(runtimeExecutable(), [entry, "daemon"], {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
    env: process.env,
  });
  let failure;
  child.on("error", (e) => {
    failure = e;
  });
  child.unref();
  for (let i = 0; i < 200; i++) {
    await sleep(50);
    if (failure) throw failure;
    const state = readJSON("daemon.json");
    if (isAlive(state.pid)) return state;
  }
  throw Error("Daemon failed to start; inspect ~/.codex-rpc/daemon.log");
}
export async function stopDaemon() {
  const d = readJSON("daemon.json");
  if (alive(d.pid)) {
    // JSON control works on Windows too, where SIGTERM force-kills Node before
    // it can clear Discord presence and remove its PID/lock files.
    writeJSON("control.json", {
      action: "stop",
      pid: d.pid,
      startedAt: d.startedAt,
      requestedAt: Date.now(),
    });
    for (let i = 0; i < 160 && alive(d.pid); i++) await delay(50);
    if (alive(d.pid))
      throw Error("Daemon did not acknowledge stop within 8 seconds");
  }
  return { stopped: true };
}
export async function setup({ noService = false, noStart = false } = {}) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  if (alive(readJSON("daemon.json").pid)) await stopDaemon();
  const settings = config();
  // Migrate only our own old bundled URLs. User-hosted URLs and asset keys stay.
  const oldEmpty =
    settings.clientId === defaults.clientId &&
    ["working", "thinking", "waiting", "idle"].every(
      (k) => !settings.assets[k],
    );
  for (const state of ["working", "thinking", "waiting", "idle"])
    if (
      oldEmpty ||
      settings.assets[state] === defaults.assets[state].split("?")[0] ||
      settings.assets[state].startsWith(
        defaults.assets[state].split("?")[0] + "?v=",
      )
    )
      settings.assets[state] = defaults.assets[state];
  if (
    settings.assets.badge ===
    "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-badge.png"
  )
    settings.assets.badge = "";
  writeJSON("config.json", settings);
  const runtime = path.join(home(), "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  for (const name of ["src", "bin", "web", "assets", "package.json"])
    if (path.resolve(root) !== path.resolve(runtime))
      fs.cpSync(path.join(root, name), path.join(runtime, name), {
        recursive: true,
      });
  if (process.env.CODEX_RPC_SEA) {
    const dir = path.join(home(), "bin");
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(
      dir,
      process.platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
    );
    if (path.resolve(process.execPath) !== path.resolve(destination))
      fs.copyFileSync(process.execPath, destination);
    fs.chmodSync(destination, 0o755);
  }
  let hook;
  try {
    hook = registerHook();
  } catch (e) {
    hook = e.message;
  }
  const service = noService ? null : installService();
  if (!noStart) await startDaemon();
  return { home: home(), hook, service, started: !noStart };
}
export async function uninstall() {
  removeService();
  await stopDaemon();
  unregisterHook();
  uninstallCompletions();
  fs.rmSync(path.join(home(), "runtime"), { recursive: true, force: true });
  return (
    "Removed hooks, service, and installed runtime. Analytics/config retained; delete " +
    home() +
    " to erase them."
  );
}

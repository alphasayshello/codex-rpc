import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  home,
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
const runtimeExecutable = () =>
  process.env.CODEX_RPC_SEA &&
  fs.existsSync(
    path.join(
      home(),
      "bin",
      process.platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
    ),
  )
    ? path.join(
        home(),
        "bin",
        process.platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
      )
    : process.execPath;
const cli = () => path.join(home(), "runtime/bin/codex-rpc.js");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export function registerHook() {
  fs.mkdirSync(codexHome(), { recursive: true, mode: 0o700 });
  const target = path.join(codexHome(), "config.toml");
  let text = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const line = `notify = ${JSON.stringify([runtimeExecutable(), cli(), "hook"])}`;
  const top = text.split(/^\s*\[/m)[0];
  if (/^\s*notify\s*=/m.test(top) && !top.includes("codex-rpc"))
    throw Error(
      "Existing Codex notify is preserved. Chain codex-rpc hook yourself or use codex-rpc run -- <args>.",
    );
  if (!fs.existsSync(file("codex-config.backup.toml")))
    fs.writeFileSync(file("codex-config.backup.toml"), text, { mode: 0o600 });
  text = text.replace(
    /^# codex-rpc notify begin\n[\s\S]*?^# codex-rpc notify end\n?/m,
    "",
  );
  const block = `# codex-rpc notify begin\n${line}\n# codex-rpc notify end\n`;
  const temp = target + ".codex-rpc.tmp";
  fs.writeFileSync(temp, block + text, { mode: 0o600 });
  fs.renameSync(temp, target);
  return line;
}
export function unregisterHook() {
  const target = path.join(codexHome(), "config.toml");
  if (fs.existsSync(target)) {
    const text = fs
      .readFileSync(target, "utf8")
      .replace(
        /^# codex-rpc notify begin\n[\s\S]*?^# codex-rpc notify end\n?/m,
        "",
      );
    fs.writeFileSync(target, text, { mode: 0o600 });
  }
}
export function serviceDefinition(platform = process.platform) {
  const node = runtimeExecutable(),
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
    const q = (s) => '"' + s.replace(/%/g, "%%").replace(/"/g, '""') + '"';
    return {
      path: path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming"),
        "Microsoft/Windows/Start Menu/Programs/Startup/codex-rpc.cmd",
      ),
      content: `@echo off\r\nset "CODEX_RPC_HOME=${home().replace(/%/g, "%%")}"\r\nset "CODEX_HOME=${codexHome().replace(/%/g, "%%")}"\r\nstart "" /min ${command.map(q).join(" ")}\r\n`,
    };
  }
  throw Error("Unsupported service platform");
}
export function installService() {
  const d = serviceDefinition();
  fs.mkdirSync(path.dirname(d.path), { recursive: true });
  fs.writeFileSync(d.path, d.content, { mode: 0o600 });
  let warning;
  try {
    if (process.platform === "darwin")
      execFileSync(
        "launchctl",
        ["bootstrap", `gui/${process.getuid()}`, d.path],
        { stdio: "pipe" },
      );
    if (process.platform === "linux") {
      execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
      execFileSync("systemctl", ["--user", "enable", "codex-rpc.service"], {
        stdio: "pipe",
      });
    }
  } catch (e) {
    warning = `Autostart registration needs attention: ${e.message}`;
  }
  return { path: d.path, warning };
}
export function removeService() {
  const d = serviceDefinition();
  try {
    if (process.platform === "darwin")
      execFileSync(
        "launchctl",
        ["bootout", `gui/${process.getuid()}/dev.codex-rpc`],
        { stdio: "pipe" },
      );
    if (process.platform === "linux")
      execFileSync(
        "systemctl",
        ["--user", "disable", "--now", "codex-rpc.service"],
        { stdio: "pipe" },
      );
  } catch {}
  fs.rmSync(d.path, { force: true });
}
export async function startDaemon() {
  const old = readJSON("daemon.json");
  if (alive(old.pid)) return old;
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const entry = fs.existsSync(cli())
    ? cli()
    : path.join(root, "bin/codex-rpc.js");
  const child = spawn(runtimeExecutable(), [entry, "daemon"], {
    stdio: "ignore",
    detached: true,
    env: process.env,
  });
  let failure;
  child.on("error", (e) => {
    failure = e;
  });
  child.unref();
  for (let i = 0; i < 200; i++) {
    await delay(50);
    if (failure) throw failure;
    const state = readJSON("daemon.json");
    if (alive(state.pid)) return state;
  }
  throw Error("Daemon failed to start; inspect ~/.codex-rpc/daemon.log");
}
export async function stopDaemon() {
  const d = readJSON("daemon.json");
  if (alive(d.pid)) {
    process.kill(d.pid, "SIGTERM");
    for (let i = 0; i < 120 && alive(d.pid); i++) await delay(50);
    if (alive(d.pid)) throw Error("Daemon did not stop within 6 seconds");
  }
  return { stopped: true };
}
export async function setup({ noService = false, noStart = false } = {}) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  writeJSON("config.json", config());
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

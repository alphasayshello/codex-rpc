import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { home, readJSON, writeJSON } from "./store.js";
export const commands = [
  "setup",
  "start",
  "status",
  "chat",
  "usage",
  "insights",
  "preview",
  "serve",
  "statcards",
  "doctor",
  "pause",
  "resume",
  "restart",
  "stop",
  "uninstall",
  "completion",
  "scan",
  "hook",
  "run",
  "help",
  "version",
];
export function completion(shell) {
  const words = commands.join(" ");
  if (shell === "bash") return `complete -W '${words}' codex-rpc\n`;
  if (shell === "zsh")
    return `#compdef codex-rpc\nautoload -Uz compinit; (( $+functions[compdef] )) || compinit\ncompdef '_arguments "1:command:(${words})"' codex-rpc\n`;
  if (shell === "fish")
    return (
      commands.map((c) => `complete -c codex-rpc -f -a ${c}`).join("\n") + "\n"
    );
  if (shell === "powershell")
    return `Register-ArgumentCompleter -Native -CommandName codex-rpc -ScriptBlock { param($wordToComplete) '${words}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_,$_,'ParameterValue',$_) } }\n`;
  throw Error("Shell must be bash, zsh, fish, or powershell");
}
export function defaultShell(
  platform = process.platform,
  shell = process.env.SHELL,
) {
  if (!shell) return platform === "win32" ? "powershell" : "bash";
  const name = (platform === "win32" ? path.win32 : path)
    .basename(shell)
    .replace(/\.exe$/i, "");
  return name === "pwsh" ? "powershell" : name;
}
export function completionSource(shell, target, platform = process.platform) {
  // Shells on Windows accept forward slashes; backslashes inside fish single
  // quotes can otherwise change the path (notably a backslash before a quote).
  if (platform === "win32" && shell !== "powershell")
    target = target.replaceAll("\\", "/");
  const quote =
    shell === "powershell"
      ? "'" + target.replaceAll("'", "''") + "'"
      : shell === "fish"
        ? "'" + target.replaceAll("'", "\\'") + "'"
        : "'" + target.replaceAll("'", "'\\''") + "'";
  return (shell === "powershell" ? ". " : "source ") + quote;
}
export function installCompletion(shell) {
  shell ||= defaultShell();
  const text = completion(shell),
    dir = path.join(home(), "completions");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `codex-rpc.${shell}`);
  fs.writeFileSync(target, text, { mode: 0o600 });
  let profile;
  if (shell === "powershell") {
    for (const executable of ["pwsh", "powershell.exe"]) {
      try {
        profile = execFileSync(
          executable,
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$PROFILE.CurrentUserAllHosts",
          ],
          { encoding: "utf8", timeout: 2000 },
        ).trim();
        if (profile) break;
      } catch {}
    }
    profile ||= path.join(
      os.homedir(),
      process.platform === "win32"
        ? "Documents/PowerShell/profile.ps1"
        : ".config/powershell/profile.ps1",
    );
  } else
    profile = path.join(
      os.homedir(),
      shell === "fish"
        ? ".config/fish/config.fish"
        : shell === "zsh"
          ? ".zshrc"
          : ".bashrc",
    );
  const line = completionSource(shell, target);
  const old = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : "";
  const clean = old.replace(
    /\r?\n?# codex-rpc completion begin\r?\n[\s\S]*?# codex-rpc completion end\r?\n?/g,
    "",
  );
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.writeFileSync(
    profile,
    clean +
      `\n# codex-rpc completion begin\n${line}\n# codex-rpc completion end\n`,
  );
  const manifest = readJSON("completion-install.json", { profiles: [] });
  if (!manifest.profiles.includes(profile)) manifest.profiles.push(profile);
  writeJSON("completion-install.json", manifest);
  return `Installed ${shell} completion in ${profile}. Open a new shell, or run: ${line}`;
}
export function uninstallCompletions() {
  for (const profile of readJSON("completion-install.json", { profiles: [] })
    .profiles) {
    if (fs.existsSync(profile))
      fs.writeFileSync(
        profile,
        fs
          .readFileSync(profile, "utf8")
          .replace(
            /\r?\n?# codex-rpc completion begin\r?\n[\s\S]*?# codex-rpc completion end\r?\n?/g,
            "",
          ),
      );
  }
  fs.rmSync(path.join(home(), "completions"), { recursive: true, force: true });
  fs.rmSync(path.join(home(), "completion-install.json"), { force: true });
}

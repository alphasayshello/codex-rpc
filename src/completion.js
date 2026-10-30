import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { home, readJSON, writeJSON } from "./store.js";
export const commands = [
  "setup",
  "start",
  "status",
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
export function installCompletion(shell) {
  shell ||= path.basename(process.env.SHELL || "bash");
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
  const quote =
    shell === "powershell"
      ? "'" + target.replaceAll("'", "''") + "'"
      : shell === "fish"
        ? "'" + target.replaceAll("'", "\\'") + "'"
        : "'" + target.replaceAll("'", "'\\''") + "'";
  const line = (shell === "powershell" ? ". " : "source ") + quote;
  const old = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : "";
  const clean = old.replace(
    /\n?# codex-rpc completion begin\n[\s\S]*?# codex-rpc completion end\n?/g,
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
            /\n?# codex-rpc completion begin\n[\s\S]*?# codex-rpc completion end\n?/g,
            "",
          ),
      );
  }
  fs.rmSync(path.join(home(), "completions"), { recursive: true, force: true });
  fs.rmSync(path.join(home(), "completion-install.json"), { force: true });
}

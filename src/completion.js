import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const commands = [
  "setup",
  "start",
  "status",
  "usage",
  "insights",
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
    return `#compdef codex-rpc\ncompdef '_arguments "1:command:(${words})"' codex-rpc\n`;
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
  const text = completion(shell);
  const dir = path.join(os.homedir(), ".codex-rpc/completions");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `codex-rpc.${shell}`);
  fs.writeFileSync(target, text);
  return shell === "fish"
    ? `source ${target} (add this line to ~/.config/fish/config.fish)`
    : shell === "powershell"
      ? `. '${target}' (add this line to $PROFILE)`
      : `source ${JSON.stringify(target)} (add this line to ~/.${shell === "zsh" ? "zshrc" : "bashrc"})`;
}

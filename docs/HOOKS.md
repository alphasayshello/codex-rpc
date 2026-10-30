# Codex lifecycle hooks

Run `codex-rpc setup`, then open **`/hooks` in Codex** to review and trust the new codex-rpc handlers. Changed definitions need another review. If the entries are absent, restart your Codex session. Setup never changes hook trust or overrides a disabled hooks feature.

`codex-rpc hooks` shows the configured integration and review guidance. `codex-rpc hooks --json` prints the same information for troubleshooting, including hook sources, feature overrides and queued-event count. Configuration alone cannot prove that Codex has trusted or executed a handler. `codex-rpc doctor` checks registration separately from daemon and Discord health.

| Hook | Presence observation |
| --- | --- |
| `SessionStart` | Ready for a prompt; compaction continuation stays thinking. |
| `UserPromptSubmit` | Start thinking for the submitted turn. |
| `PreToolUse` | Track the actual tool, safe file metadata and command summary. |
| `PostToolUse` | Finish that invocation; keep unknown outcomes unknown. |
| `PermissionRequest` | Waiting for approval. |
| `Stop` | Turn finished; show success briefly, then idle. |
| `Interrupt` | End the turn as interrupted and wait for the user. |
| `SessionEnd` | Session idle. |
| `PreCompact` / `PostCompact` | Thinking through context compaction. |

Subagent lifecycle events do not end the parent chat. Available native events depend on your Codex version and execution surface. The session-log watcher and legacy completion notifier remain compatible fallback sources; missing native metadata is never fabricated.

## What setup changes

Setup appends a marked block of inline hook tables to `~/.codex/config.toml`. The commands point at the stable runtime beneath `~/.codex-rpc/runtime/` and preserve alternate `CODEX_HOME` / `CODEX_RPC_HOME` values. POSIX paths are quoted literally; the Windows override invokes an encoded PowerShell command without putting user paths into shell syntax.

Existing notifiers, user hook tables, external `hooks.json` files, feature flags and trust decisions are preserved. A custom notifier can coexist with native codex-rpc hooks. Unsafe or malformed owned marker blocks are reported rather than overwritten. The original config backup is retained at `~/.codex-rpc/codex-config.backup.toml`. Uninstall removes only codex-rpc's owned blocks.

Callbacks are small observational commands with a three-second timeout. They return no approval, denial, tool rewrite or continuation decision. `Stop` returns an empty JSON object as required by its output contract. A failed native observation does not intentionally block a tool or continue a turn; legacy manual input errors still produce diagnostics.

## Concurrent tools and late log records

Hooks and the log watcher may observe the same invocation. Call IDs prevent double counting. A local metadata inbox under `~/.codex-rpc/events/` serializes state and recap updates across processes. Contended writers enqueue complete redacted JSON and return; the daemon drains remaining events. Keep the daemon running. The inbox holds normalized metadata only, with the same private/public filtering as live state.

Late cumulative usage can update a chat without rewinding its tool, status or timer. Completed turn recaps are reconciled only when a matching turn identity is available. Missing baselines, incomplete edits and unknown results stay unknown. Proposed changes from failed tools are not reported as successfully applied lines.

The authoritative event schema and trust behavior are documented in [OpenAI's hook guide](https://learn.chatgpt.com/docs/hooks).

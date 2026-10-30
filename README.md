<div align="center">

<img src="assets/pet/preview-banner.svg" width="800" alt="codex-rpc — a little presence. Working, thinking, waiting, idle." />

**Discord Rich Presence for Codex CLI & ChatGPT Desktop.**<br/>
Your chat. Your tools. Your little pet. Everything local.

[MIT](LICENSE) · Node 18+ · zero runtime dependencies · [security](SECURITY.md)

</div>

---

## install

This project releases through **GitHub downloads**. The npm name `codex-rpc` belongs to an unrelated project; do not install this repository with `npx codex-rpc@latest`.

From source, available now:

```sh
git clone https://github.com/alphasayshello/codex-rpc.git
cd codex-rpc
npm ci
npm link
codex-rpc setup
codex-rpc serve
```

After **v0.2.0** is published, install its archive with Node 18+:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/download/v0.2.0/codex-rpc-0.2.0.tgz
codex-rpc setup
```

Native downloads and checksums are prepared by the release workflow. See [release instructions](docs/RELEASE.md); no GitHub release or registry package is published automatically.

Setup refreshes running code and old bundled asset URLs while preserving custom URLs. It copies a stable runtime into `~/.codex-rpc/runtime/`, registers the user-level Codex `notify` command, enables lightweight ChatGPT detection, installs login autostart, and starts the daemon. Existing notifiers are preserved; setup explains how to use the wrapper instead. No administrator access required. `setup --no-service --no-start` writes only integration files.

Open **http://localhost:47474**. The default application is `1565535814308470814` and the four GIFs plus badge are hosted directly in [this GitHub repository](https://github.com/alphasayshello/codex-rpc/tree/main/assets/pet). No asset upload is needed once these commits are pushed. Use **Settings → Discord / Codex Pet Assets** to supply your own application, HTTPS GIF URLs, or uploaded Discord asset keys.

Discord **Desktop** must be running. Browser-only Discord cannot expose its local IPC socket. Discord controls whether remote GIFs animate; uploaded application art may be static. All four actual animated GIFs ship in this repository.

## on Discord

```text
Watching Codex RPC
Working in Codex RPC
Bash · 22.8k output tokens
▣ 0:58 elapsed
```

The default card follows [claude-rpc’s status templates](https://github.com/rar-file/claude-rpc/blob/main/src/default-config.js): **working** shows tool, file and tool elapsed time when available, then this chat’s **output tokens**; **thinking** shows model, prompts and output tokens; **waiting** shows model and prompts; **idle** shows model and today’s active hours. Missing fields disappear cleanly. The headline uses the conversation name when public. Input and cached tokens are never added to the Discord token counter. Full usage breakdowns remain available locally in the dashboard and `chat --json`.

The pet tooltip describes the live action; the pixel badge tooltip names the tool or status. Discord controls wrapping, fonts and application name; the bundled application is named **Codex RPC**. `Watching` is the default activity type.

For that named-chat layout, open `codex-rpc serve`, choose **Privacy → public**, and leave **Presence → Show conversation name** enabled. Private mode keeps task and project names out of the card. The default stats line is **This chat**. Presence also offers **Today / all-time cost**, **Model / tokens**, and a **Playing / Watching** header. `codex-rpc preview` prints the exact text and asset URLs for all four states before you share anything.

The blue pet uses selected original poses with deliberate holds, not a rapid expression slideshow: work keeps its neutral terminal face, with one brief blink in a 5.22-second loop. Other states move slowly or give an occasional wave. Dashboard SSE updates preserve an animation already in progress. Ten pixel badges cover commands, thinking, completion, idle, approval, editing, reading, review, ready and errors. They are drawn on a crisp 24-pixel grid and enlarged without antialiasing; the card selects a badge from the live tool/state. A custom badge URL overrides them.

<img src="assets/pet/status-badges.svg" width="800" alt="Ten pixel-art status badges" />

## three small pieces

```text
                       01. hook
Codex notify / wrapper ───┐
Codex session log tail ───┼──→ state.json ──→ 02. daemon ──→ Discord IPC
ChatGPT process/window ──┘                       ↑
                                                  │
~/.codex/sessions/**/*.jsonl ──→ 03. scanner ──→ aggregate.json
                                  │              sessions.json
                           scanner-cache.json          │
                                                  TUI · web · cards
```

**01. hook** — a short-lived JSON reader. Accepts stdin or the notify JSON argument, normalizes lifecycle events, atomically replaces state, exits. No network work in the hook. “Zero blocking delay” means no artificial sleeps or network waits on the normal hook path; reading/writing local files still takes time. Windows transient file-handle conflicts receive a bounded retry (up to 71 ms total) to preserve atomic writes; normal writes do not wait.

**02. daemon** — a small, long-lived Node process. Tails modified session logs, polls ChatGPT process/window state, watches JSON files, and sends raw Discord IPC frames. Fragmented frames, READY handshakes, ACKs, ping/pong, reconnect backoff with jitter, and 5 MiB log rotation are handled locally. Updates are coalesced with a minimum 15-second interval to avoid Discord throttling. Disabled presence clears immediately.

**03. scanner** — a short-lived child. Recursively discovers JSONL session logs and only parses files whose size or modification time changed. A modified file is re-read in full so cumulative token counters, rewrites, and truncated tails remain correct. Deleted files leave both the aggregate and per-chat index. `sessions.json` keeps each conversation’s own usage, tools and costs, keyed by its actual session ID. `history.jsonl` is a prompt-only fallback when session logs are absent, so overlapping history never doubles totals.

## the pet has a job

| state | preview | when |
| --- | --- | --- |
| working | <img src="assets/pet/codex-pet-working.gif" width="96" alt="Original blue Codex Pet working at a laptop" /> | tool execution, shell, editing, active goal work |
| thinking | <img src="assets/pet/codex-pet-thinking.gif" width="96" alt="Original blue Codex Pet pondering" /> | task start, user prompt, reasoning |
| waiting | <img src="assets/pet/codex-pet-waiting.gif" width="96" alt="Original blue Codex Pet waving for attention" /> | turn complete, approval event, foreground ChatGPT |
| idle | <img src="assets/pet/codex-pet-idle.gif" width="96" alt="Original blue Codex Pet calmly blinking" /> | session end, timeout, backgrounded/closed ChatGPT |

The **actual blue Codex companion**, reused from OpenAI’s official [Codex pet sprite sheet](https://cdn.openai.com/c6d7b0d0-3abf-40b5-9d0c-ecd2b9364692/codex-spritesheet-v4.webp), not a newly drawn mascot. `npm run assets` extracts existing animation rows using Node built-ins: laptop work → working, pondering → thinking, waving → waiting, calm blink → idle. No new typing sparks, question bubbles, or sleep effects are invented. Frame selection and holds avoid rapid face changes. The looping GIFs use the original 192×208 frame geometry; PNG and embedded-PNG SVG previews retain the original RGBA pixels. Source hashes and row mappings are in [manifest.json](assets/pet/manifest.json); attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


## what is observable

Codex's documented [`notify`](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications) fires `agent-turn-complete` with a JSON **argument**. It is not a full lifecycle hook stream. We map it to waiting, use the wrapper for session boundaries, and tail local Codex logs for task starts, reasoning, tool calls, and completion. Unknown schemas are ignored safely. Approval/waiting is exact only when the producer actually emits an approval event; no screen scraping or invented approvals.

```sh
codex-rpc run --                  # interactive Codex, plus start/end events
codex-rpc run -- exec 'fix tests' # passes args directly to codex
printf '%s\n' '{"type":"approval-request"}' | codex-rpc hook
```

If your existing `notify` must be retained, chain `node /absolute/path/to/codex-rpc/src/hook.js "$1"` in your own notifier, or use the wrapper and log tailer. Hook adapters can emit `working`, `thinking`, `waiting`, `idle`, `turn-start`, `tool-start`, `tool-end`, `approval-request`, `agent-turn-complete`, or `session-end`. Include `source: "chatgpt"` to identify a ChatGPT producer.

ChatGPT detection is process-only on Windows; macOS uses System Events for foreground detection (OS privacy permission may be needed), Linux optionally uses `xdotool` on X11. When foreground is unavailable, a running app is shown as waiting. Detection does **not** read chats, infer model reasoning, or access private ChatGPT databases. ChatGPT foreground intervals and observed process starts are accumulated locally from installation onward. Unknown foreground never adds focus hours. Token/prompt/tool analytics require a compatible JSONL producer; process detection cannot recover past chats or past token usage. Work with Apps is represented as app activity, not an undocumented pairing API.

## commands

| command | does |
| --- | --- |
| `setup` | stable runtime, Codex notify, detector, login service, daemon |
| `start` / `stop` / `restart` | manage the daemon |
| `status [--watch]` | live state, ASCII pet, this chat, totals, heatmap and rankings |
| `chat [--json] [--watch]` | current conversation’s tokens, tools, prompts, time and estimated cost |
| `usage [--watch]` | heat-graded bars, 52-week heatmap, hour histogram, tools, languages, cost |
| `insights` | trend, peak weekday, hotspot, cost/token pace, streak |
| `preview` | exact current Discord text and asset URLs for all four states |
| `serve [--port 47474]` | dark dashboard, SSE, range filters, interactive year heatmap |
| `statcards [--output ./statcards]` | SVG card with embedded pet, 12-month heatmap, four badges, Markdown |
| `doctor` | Node, notify, detector, daemon, real Discord handshake, aggregate age, privacy |
| `pause` / `resume` | persist `enabled: false` / `true`; kill switch for new collection and presence |
| `scan` | update lifetime and per-chat history immediately |
| `hook [JSON]` | ingest argument or newline-delimited stdin JSON |
| `run -- [Codex args]` | wrap Codex with lifecycle boundaries |
| `uninstall` | remove hook block, service, runtime; retain analytics/config |
| `completion install [shell]` | install bash/zsh/fish/PowerShell completion and a managed profile block |
| `completion <shell>` | print completion script |
| `help` / `version` | reference / version |

No subscription quota requests or credential reads. `usage` means recorded local activity, not account limits.

## on your machine

Choose a conversation in **Conversation on Discord**, then press **Pin to Discord**. Pinning persists across restarts and applies to the card, current-chat dashboard, timeline and CLI status. Other chats keep collecting data. **Follow latest** returns to automatic selection; an idle pinned chat stays idle rather than switching to another conversation.

The **Tool timeline** shows up to 50 recent observed calls with live durations, completed/failed/unknown outcomes, and numeric exit codes when available. It never displays arguments, stdout or raw error bodies. Older history may have fewer events or unknown outcomes.

A ChatGPT-inspired workspace with neutral dark and light themes, a collapsible sidebar, and a mobile navigation drawer. Switch appearance at the bottom of the sidebar; appearance stays in this browser. Settings support keyboard navigation and all seven categories.

The **THIS CHAT** headline counts output tokens only. Its separate breakdown follows the selected live conversation: input/output/reasoning/cached tokens, cache reuse, latest request/context window when reported, prompts, tool calls, active time, line changes and API-equivalent cost. Running and recent tools show names and recorded durations, never raw arguments. Unknown values show **—**, not a lifetime total.

Dashboard range: **7d · 30d · 90d · 1y · all**. The year heatmap stays year-wide; headline totals, languages, tools, costs, source breakdown and hour chart follow the range. UTC dates keep the CLI, cards, and scanner consistent.

<img src="docs/dashboard.png" width="1000" alt="Local dark dashboard with Codex Pet, token/hour/session totals and activity heatmap (synthetic sample data)" />

The chat panel is independent of this range; switching chats switches its identity and metrics. For the same view in your terminal, run `codex-rpc chat --watch`; use `codex-rpc chat --json` for scripts.

Seven settings tabs: **Presence · Discord · Codex Pet Assets · Timing · Daemon Controls · Privacy · Stats**. Save locally, no cloud account. The daemon controls start, pause, resume, restart and stop the background process. The dashboard itself remains open after stop.

Local read-only JSON endpoints include `/api/state`, `/api/aggregate?range=30d`, **`/api/chat`**, `/api/chats`, and `/api/timeline`. The chat endpoint returns the current conversation summary, with `null` for unavailable metrics; it never substitutes all-time usage.

Local SVG endpoints update from the latest aggregate on every request:

```text
/cards/stats.svg       /cards/heatmap.svg
/cards/tokens.svg      /cards/sessions.svg
/cards/hours.svg       /cards/streak.svg
```

`statcards` exports snapshot files plus a README. `serve` provides live **local** URLs; GitHub cannot fetch your localhost. To share cards, commit exported SVGs or host them yourself. This project never publishes analytics automatically.

Optional Electron shell:

```sh
cd electron
npm install
npm start
```

Electron runs the same loopback dashboard on a random port with Node integration off, context isolation and sandboxing on. The normal CLI has no Electron dependency.

## settings & privacy

`~/.codex-rpc/config.json` contains overrides. See [config.example.json](config.example.json). Default privacy is `private`: Discord receives “a private project”, not task titles or project/file names. Public mode uses the actual conversation name from `~/.codex/session_index.jsonl`; later messages never replace it. Renames are picked up automatically. Unnamed chats fall back to the project label; full prompts are not used as display titles. Tokens, model, tool name, hours and streak can still be shared. Public buttons and URLs are explicit user configuration.

```json
{
  "enabled": true,
  "privacy": "private",
  "clientId": "1565535814308470814",
  "presence": { "stats": "chat", "showTask": true, "showChurn": true },
  "assets": {
    "working": "https://your-host/codex-pet-working.gif",
    "thinking": "https://your-host/codex-pet-thinking.gif",
    "waiting": "https://your-host/codex-pet-waiting.gif",
    "idle": "https://your-host/codex-pet-idle.gif",
    "badge": "https://your-host/codex-badge.png"
  },
  "buttons": [{ "label": "View GitHub", "url": "https://github.com/you/repo" }]
}
```

`enabled: false` stops new hooks, log tailing, scans and presence. It does not erase existing data. Config changes take effect without daemon restart. Use `CODEX_RPC_HOME` and `CODEX_HOME` to isolate state/input roots; `CODEX_RPC_IPC` selects a bridged socket; `CODEX_RPC_CODEX_BIN` overrides the wrapped Codex executable.

State and cache files are inspectable JSON (0700 directory, 0600 files on POSIX). `codex-state.json` and `chatgpt-state.json` retain per-source snapshots. `state.json` is the selected live activity. `aggregate.json` holds lifetime totals and daily slices. `sessions.json` holds the scanned per-conversation summaries. `live/` keeps source-scoped, hashed-ID chat snapshots so switching chats cannot carry another chat’s counters into the next one. `desktop-aggregate.json` stores observed ChatGPT focus/session summaries, and `chatgpt-observation.json` stores the last process observation. `scanner-cache.json` holds per-file summaries, file paths and metadata, never raw transcript content. Even in private mode, this local cache can contain hotspot paths; privacy redaction applies to presence, per-chat API/CLI views, and aggregate views. Per-chat exports redact hotspot filenames in private mode; live snapshots omit task/project/file names. Hashed snapshot filenames do not encrypt their contents. See [SECURITY.md](SECURITY.md) for the full model.

macOS installs `~/Library/LaunchAgents/dev.codex-rpc.plist`. Linux installs `~/.config/systemd/user/codex-rpc.service`. Windows installs a per-user Startup `.cmd` task; no elevation or machine-wide service. On Linux without a user systemd session, setup prints a registration hint and still starts a detached daemon. WSL requires Discord in the same environment or an explicit trusted Unix socket bridge via `CODEX_RPC_IPC`; Windows named pipes are not directly available to Linux Node.

## counting things honestly

Input, output, cached-input and reasoning tokens are separate. Total tokens are input + output; reasoning is already part of output. Within each conversation, new `token_usage_record` entries are preferred and deduplicated by response ID; legacy cumulative token-count records are differenced only when those records are absent. Reasoning and cost are never counted through both streams. Tool call IDs and paired user-message records are deduplicated within each log. Active time sums timestamp gaps capped at five minutes, an approximation of engaged time. Missing timestamps are marked unknown, not assigned fake dates. File languages and line churn are derived only from logged tool arguments/patches, not a whole-repository Git diff. Session-log copies outside the sessions tree are not scanned. Hotspot counts mean tool touches, not unique changed files.

Chat totals combine matching session-ID history and live observations without adding the same cumulative counters twice. Lifetime aggregates never fill missing chat metrics. Prompts, tools, line changes and active time need compatible local logs; live tool counts cover observed calls. ChatGPT process detection alone cannot reveal a conversation ID, title, model or token usage, so unavailable chat data stays unknown.

Prices are **USD API-equivalent estimates**, not a ChatGPT/Codex subscription bill. Rates are snapshots, not fetched at runtime. Unknown models accumulate `unknownCostTokens` and contribute no invented cost. Historical models are retained for old sessions. Source rates checked 2026-10-29: [o3](https://developers.openai.com/api/docs/models/o3), [o4-mini](https://developers.openai.com/api/docs/models/o4-mini), [GPT-5](https://developers.openai.com/api/docs/models/gpt-5), [codex-mini-latest](https://developers.openai.com/api/docs/models/codex-mini-latest), [current pricing](https://developers.openai.com/api/docs/pricing). Update the inspectable table in `src/pricing.js` when prices change.

## build & verify

```sh
npm run assets
npm run check
npm test
npm pack --dry-run
npm run build:sea
```

Normal runtime: Node 18+. SEA build: an official Node 25.5+ binary with SEA enabled (some Homebrew builds disable it). The self-contained executable embeds the source, web UI and pet assets, then extracts a versioned local runtime on first launch. Build output: `dist/codex-rpc` (`.exe` on Windows). The current platform's executable is built locally; cross-platform binaries require builds on those platforms. No bundler, runtime SDK or native addon.

Tests use isolated temporary homes and a real local fake Discord IPC server, so testing never installs services or alters your Codex settings. CI covers Node 18/22/26 on macOS/Linux/Windows; platform services are tested as descriptors, not installed into CI users' login sessions. See [verification notes](docs/VERIFICATION.md).

## project

```text
bin/codex-rpc.js       CLI entry
src/hook.js           01. event hook
src/daemon.js         02. Discord supervisor
src/scanner.js        03. incremental history scanner
src/ipc.js            raw Discord IPC client
src/presence.js       card templates and compact usage text
src/chat.js           current-chat history/live summary
src/live.js           scoped snapshots and token normalization
src/log-watcher.js    live JSONL tailer
src/chatgpt-detector.js
src/pricing.js        token cost snapshots
src/tui.js            terminal views / insights
src/server.js         loopback HTTP + SSE
src/statcards.js      local SVG exports
src/doctor.js         diagnostics
src/service.js        setup / login services
src/completion.js     four shells
src/assets/           deterministic GIF generator
assets/pet/           generated GIFs + SVG previews
web/                  dependency-free dashboard
electron/             optional desktop shell
test/                 node --test suites
scripts/              syntax / SEA builds
```

Modeled on [rar-file/claude-rpc](https://github.com/rar-file/claude-rpc), inspected at `fa3798d0e18830106fc923f0a4c4d10dd400e0b4`. Same three-piece JSON glue, command conventions and compact developer-first presentation; independent implementation adapted to Codex. No upstream telemetry, community publishing, authentication or Claude-specific integrations. Unaffiliated with OpenAI or Discord.

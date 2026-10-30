# Changelog

## 0.2.0

- Writing now alternates articulated paw presses while the face, body and laptop stay fixed; remove writing bounce and flying-card effects.

- Suppress recurring Windows detector console flashes; hide scanner/daemon/helper launches and migrate owned Startup launchers to a hidden path with engine diagnostics.
- Summarize newly observed turns with output-only usage deltas, tool counts, duration and outcome.
- Add six 10 fps full-body animation scenes around the original pet, animated status badges, a CSP-safe preview gallery, stepped UI indicators and persisted reduced-motion preferences.

- Pick a conversation and pin it to Discord across daemon restarts. Follow latest restores automatic selection.
- Inspect a live tool timeline: running durations, completed calls, failures and exit codes, without raw arguments or output.
- Show live edited files, parsed diff counters, safe command summaries, precise operation timers and selected-chat output tokens; retain legacy Claude-style layouts.
- Coalesce presence counters with a bounded transition budget, latest-only buffering, ACK-aware retries and immediate pause clearing.
- View per-chat usage separately from lifetime analytics.
- Use ChatGPT-inspired dark/light themes, mobile navigation and keyboard settings tabs.
- Harden native shell setup, Windows file replacement and IPC paths, hook registration, and metadata redaction.
- Prepare GitHub-only release archives, optional native Node SEA executables and SHA-256 checksums.

## 0.1.0

Initial source implementation: raw Discord IPC, lifecycle hooks, incremental analytics, original Codex Pet assets, CLI, local dashboard and stat cards.

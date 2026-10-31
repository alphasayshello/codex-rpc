# codex-rpc 0.5.0 — your workspace, in focus

Source/local preview. Not yet published to npm or GitHub Releases.

- A ChatGPT-inspired workspace with a quieter sidebar, matching light/dark themes, focused pages and a seven-tab settings dialog.
- Search conversations and open their output usage, tools and turn recaps without changing your Discord card. Pinning remains an explicit action.
- Pet Studio lives inside the workspace. Your import draft survives navigation, and its theme and motion follow the dashboard.
- One dashboard request per live refresh replaces nine. Historical ranges are cached, unchanged charts keep their existing elements, and duplicate filesystem events are coalesced.
- Hidden pages stop requesting live snapshots. Offscreen pet previews use still frames and resume when visible.
- Legacy history without a source belongs to Codex, preventing ChatGPT conversations from borrowing its usage.
- Legacy absolute hotspot/tool paths get safe labels, and metadata named `constructor`, `__proto__` or `toString` counts correctly.
- Settings preserve typing and focus even if a configuration refresh arrives while you edit.

The synthetic comparison recorded 234 → 13 API requests for 12 chat updates, with no unchanged heatmap-cell replacements. Batching adds a short delay; [measurement details](PERFORMANCE.md) include latency and memory limits.

All processing stays local. Existing configuration, pets, history and Discord pins are preserved.

Published users should continue using 0.4.0 until this preview is released. Source testers can run `npm ci`, `node bin/codex-rpc.js setup`, then `node bin/codex-rpc.js serve`.

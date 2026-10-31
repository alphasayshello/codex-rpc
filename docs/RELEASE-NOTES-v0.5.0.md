# codex-rpc 0.5.0 — your workspace, in focus

Available on **GitHub Releases**. The npm registry remains at **0.4.0** for now.

- A ChatGPT-inspired workspace with a quieter sidebar, matching light/dark themes, focused pages and a seven-tab settings dialog.
- Search conversations and open their output usage, tools and turn recaps without changing your Discord card. Pinning remains an explicit action.
- Pet Studio lives inside the workspace. Your import draft survives navigation, and its theme and motion follow the dashboard.
- One dashboard request per live refresh replaces nine. Historical ranges are cached, unchanged charts keep their existing elements, and duplicate filesystem events are coalesced.
- Hidden pages stop requesting live snapshots. Offscreen pet previews use still frames and resume when visible.
- Legacy history without a source belongs to Codex, preventing ChatGPT conversations from borrowing its usage.
- Legacy absolute hotspot/tool paths get safe labels, and metadata named `constructor`, `__proto__` or `toString` counts correctly.
- Settings preserve typing and focus even if a configuration refresh arrives while you edit.

The synthetic comparison recorded 234 → 13 API requests for 12 chat updates, with no unchanged heatmap-cell replacements. Batching adds a short delay; [measurement details](https://github.com/alphasayshello/codex-rpc/blob/v0.5.0/docs/PERFORMANCE.md) include latency and memory limits.

All processing stays local. Existing configuration, pets, history and Discord pins are preserved.

## Install or update

With Node 18+:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/download/v0.5.0/codex-rpc.tgz
codex-rpc setup
codex-rpc serve
```

Restart any dashboard already running before the update. Existing configuration, history, pets and Discord pins are retained. Keep Discord Desktop running.

Standalone downloads bundle Node for macOS ARM64, Linux x64 and Windows x64. Choose the matching executable, verify it against `SHA256SUMS`, and run it with `setup`; on macOS/Linux, mark it executable first. The macOS binary is ad-hoc signed; the Windows binary is unsigned. Electron remains an optional source wrapper.

`codex-rpc.tgz` and `codex-rpc-0.5.0.tgz` contain the same package. `release.json` records the source revision, build run and artifact hashes. The generated GitHub source-code archives are for development; use the attached package or executable for installation.

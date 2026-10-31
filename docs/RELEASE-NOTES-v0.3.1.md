# codex-rpc v0.3.1 — Shorter paths, cleaner presence

## Fixed

- **Safe public file labels.** An edit to `/Users/name/codexrpc/src/ok.ts` now appears as `codexrpc/src/ok.ts`. Windows drive/user paths and UNC network prefixes are stripped too. Unknown external files show only their filename; private mode continues to hide filenames entirely.
- **Protection for existing snapshots.** Paths are formatted at the Discord output boundary, so upgrading protects cached state without rebuilding analytics. Telemetry and Claude-style chat layouts use the same formatter.
- **Safer command summaries.** Cached shell summaries are checked again before display. File arguments, URLs, environment values and flags are not sent as command text.
- **Watching Codex.** Every activity now explicitly sends `name: "Codex"`, and the dashboard preview uses that same name. Watching remains the default, with Playing still available as a preference. Older Discord clients may require naming the registered application `Codex` in the Developer Portal as a fallback.
- **Verified release assembly.** Tagged builds now create a draft with all three native executables, identical latest/versioned tarballs, a source/build manifest and combined SHA-256 checksums. Publication remains a separate review step.
- **Accurate dashboard version.** The footer reads the running server's package version instead of a hardcoded release number.
- **Upgrading after trusting hooks.** Setup recognizes Codex trust/disable records inserted inside its managed marker block and preserves them byte-for-byte outside that block. Existing trust is never fabricated or silently reset; unrelated configuration remains protected.

All 19 pet scenes, output-only chat counters, lifecycle hooks and settings remain compatible. No data migration is required.

## Install or update

With Node 18+:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/latest/download/codex-rpc.tgz
codex-rpc setup
codex-rpc serve
```

Setup refreshes the installed runtime and restarts the daemon while preserving your settings, custom images and analytics. Keep Discord Desktop running. Review new or changed native handlers through `/hooks` in Codex if requested; setup never bypasses trust.

Alternatively, download the standalone executable matching your OS/architecture and verify `SHA256SUMS`. macOS/Linux downloads require `chmod +x <filename>`. The binaries bundle Node; macOS is ad-hoc signed and Windows is unsigned. Electron remains an optional source wrapper.

This is a GitHub-only release. The unscoped npm package name belongs to another project. Public mode still intentionally shares project/file names and configured conversation titles; choose private mode to redact them.

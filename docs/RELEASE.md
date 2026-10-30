# codex-rpc 0.3.0 — release candidate

Nineteen smooth pet scenes, automatic tool-aware animation selection, a visual settings picker and an interactive Pet studio, alongside live telemetry, analytics and chat pinning.

This is a GitHub-only release. The unscoped npm name `codex-rpc` belongs to an unrelated project. Do not use `npx codex-rpc@latest` or `npm publish` for this repository. The package is marked private to prevent accidental registry publication; the tarball still installs normally.

## Maintainer steps

1. Commit all changes and push `main`: `git push origin main`.
2. Wait for the **verify** workflow: all nine macOS/Linux/Windows × Node 18/22/26 jobs must pass. Resolve failures before tagging.
3. Run **Build release archives** from GitHub Actions → Run workflow → `main`. It tests and builds each native platform with official Node 26, then uploads archives and checksums. It does not publish a release.
4. Download and extract all three workflow artifacts. Test each native binary and background service on its target OS before claiming native installer coverage. macOS binaries are ad-hoc signed, not notarized; Windows binaries are not Authenticode signed.
5. Create and push the release tag only after checks: `git tag -a v0.3.0 -m "codex-rpc 0.3.0"` then `git push origin v0.3.0`. Tagging also builds archives again from that exact commit; use these final artifacts.
6. Create a draft GitHub release for `v0.3.0`. Paste [RELEASE-NOTES-v0.3.0.md](RELEASE-NOTES-v0.3.0.md) into the release body. Upload both `codex-rpc.tgz` and `codex-rpc-0.3.0.tgz` from one platform build, plus each platform executable and the matching checksums (rename each platform's SHA256SUMS to avoid duplicate filenames). Review then publish manually.

GitHub release page: https://github.com/alphasayshello/codex-rpc/releases/new

## Install after publication

Requires Node 18+ for the tarball:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/latest/download/codex-rpc.tgz
codex-rpc setup
codex-rpc serve
```

Alternatively download the executable matching your OS and architecture, verify its SHA-256 checksum, mark it executable on macOS/Linux, and run it with `setup`. Standalone builds bundle Node; they do not need a separate Node installation. Keep Discord Desktop running.

The current workflow builds the architecture provided by each GitHub runner. Executable filenames include the actual OS and architecture; no unsupported architecture is implied.

## Local preparation

```sh
npm ci
npm run assets
npm run check
npm test
npm run release:prepare
```

For a native binary, run `npm run release:prepare -- --sea` with an official SEA-enabled Node 26. Homebrew Node may disable SEA. Output is in `dist/release/<platform>-<arch>/`; nothing is uploaded. Optional Electron is a source wrapper, not a packaged desktop installer in this release.

## Privacy and limits

Pinning stays in local `selection.json`; it never changes a Codex conversation. A pinned inactive or removed chat stays idle rather than leaking another conversation. Private mode redacts names and files. Tool outcomes are best-effort metadata from logs, not a security audit; interrupted calls can have unknown results. Desktop process observation cannot invent chat tokens. Costs are API-equivalent estimates, not subscription bills. No telemetry or automatic analytics publishing.

Before publication, check all 20 hosted GIF asset URLs (19 scenes plus legacy working alias) from config.example.json against committed hashes and confirm the visual scenes in Discord. For Windows, verify at least 15 seconds of detector polling without console flashes, scanner startup, and fresh-login autostart. The native console-visibility probe must pass in the Windows CI jobs. The local macOS build cannot certify those Windows-specific behaviors.

Always attach **codex-rpc.tgz** to every published release. It is byte-identical to the versioned tarball and keeps the README latest-install URL working without a README edit. The build copies paste-ready release notes to RELEASE-NOTES.md; RELEASE.md is the maintainer checklist, not the public release body. No release is published by the build script.

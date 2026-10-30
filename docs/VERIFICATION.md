# Verification record

Verified locally on macOS ARM64, 2026-10-29. Test homes and Codex inputs were disposable directories; no production hook or login service was installed as part of these checks.

| Requirement | Evidence |
| --- | --- |
| Original blue Codex pet | Downloaded built-in pet ID `codex` via Pets; original WebP SHA-256 `5cd7af9cfeae88fe9c6e47a72460e0dc4c6fb04baf7fdc6cca14a212f0bf44d1`. Source and normalized PNG are bundled. Every visible extracted preview pixel is compared with its original sprite cell by `test/assets.test.js`. |
| Four animated states | `node src/assets/generate-pet-gifs.js`; independent GIF/LZW decoder checks all frames, 192×208 dimensions, looping metadata, frame differences, and exact generated GIF bytes. Existing source poses: working 6, thinking 6, waiting 4, idle 6 frames. |
| Reproducible assets | Generated on Homebrew Node 26.10.0 and official Node 18.20.8; all output hashes match. PNG encoding uses deterministic fixed-Huffman DEFLATE to avoid platform zlib encoder differences. |
| Hook lifecycle and ChatGPT transitions | Lifecycle, stdin/argument ingestion, ordering, private/public state, disabled collection and concurrent atomic-write tests. |
| Incremental scanner | Real-shaped fixtures for legacy cumulative counters and modern per-response records; duplicate messages, calls and token streams; cached input/reasoning costs; languages, line churn, history fallback, source attribution, daily streaks, cache reuse, file modification/deletion, malformed tails and exited-worker lock recovery. |
| ChatGPT lifetime observations | Foreground intervals and observed process starts contribute hours/session totals; unknown/background focus never invents time or tokens. |
| Discord IPC | Local real-socket simulator tests handshake fragmentation, ACKs, ping/pong, private payloads, asset selection, disconnect, backoff and log rotation. Full daemon test tails a live log, publishes, clears on pause and reconnects on resume. |
| Real Discord Desktop | Application `1565535814308470814` successfully received READY and acknowledged a real `SET_ACTIVITY` command. Presence was cleared after the check. GitHub-hosted blue GIF rendering must be checked after the user pushes the new assets. |
| CLI | `help`, `version`, `status`, `usage`, `insights`, `doctor`, `scan`, `statcards`; setup with isolated config; stable runtime installation; start/restart/stop; pause/resume; shell completion installation; Codex wrapper argument forwarding. |
| HTTP/dashboard | State/aggregate/config APIs, range boundaries, Host/Origin/request-token checks, static assets, SVG card endpoints and live SSE updates. |
| Settings and visual layout | `npm --prefix electron run verify`: all seven tabs, save settings, range changes, interactive heatmap, SSE and pause; no horizontal overflow at 1440 and 430 pixels. Captured and visually inspected `dashboard.png`, `settings.png`, `mobile.png`, using synthetic data. |
| Stat cards | Embedded source-derived pet SVG, 12-month heatmap, tokens/sessions/hours/streak badges and Markdown exports. |
| Node support | Full `node --test` suite: 31 passing tests on Node 18.20.8 and Node 26.10.0. `npm run check` passes. |
| Packaging | `npm pack --dry-run --json` verifies the CLI, source, generated assets, optional Electron source, config example and documentation, without nested `node_modules`. |
| Standalone executable | Built with official Node 26.10.0 SEA, ad-hoc signed on macOS. Verified help, setup without service installation, stable executable copy, daemon start, scanner and stop in an isolated home. Homebrew's Node build has SEA disabled, so official Node is required for this build step. |
| Git/documentation | Logical commits; README, SECURITY, VERSIONING, MIT license for original code and third-party mascot provenance. |

The first GitHub workflow at commit `54633b1` failed its asset-regeneration gate before running tests. The platform-dependent PNG encoding that caused that gate failure has been replaced. The new commit must be pushed before the nine-job macOS/Linux/Windows, Node 18/22/26 matrix can verify the updated revision. This record does not claim those pending remote checks passed.

OS installers are tested as service descriptors and isolated installation logic. Linux systemd and Windows Startup activation have not been exercised on this macOS host. Live ChatGPT state transitions are tested with deterministic process-result fixtures; macOS Automation permissions and Linux/Windows foreground capabilities remain environment-dependent. The utility cannot recover ChatGPT conversation/token history from process observation.

No npm package/release was published automatically. The user handles GitHub pushes. After pushing, verify that each configured raw GitHub asset URL serves the new GIF bytes, inspect the real Discord card, and review the cross-platform CI results.

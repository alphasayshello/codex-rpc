# Dashboard performance — 0.5.0

The CLI and daemon still have zero runtime dependencies. These changes reduce browser and local HTTP work; they do not change scanner totals or Discord update limits.

## What changed

- One `/api/dashboard` snapshot replaces nine requests on each live refresh. Older API routes remain available.
- Historical JSON and range reductions are cached by file identity, UTC day and settings. Privacy changes invalidate the visible result immediately.
- Filesystem bursts are coalesced for 80 ms, with a short client scheduling window. Native events and the polling fallback can still report the same logical change twice.
- Stable section signatures and keyed conversation rows preserve unchanged DOM, keyboard focus and animations. Running tool timers update their text without rebuilding their rows.
- Hidden tabs defer snapshot requests until visible. Offscreen previews and previews obscured by the settings dialog/mobile drawer use still images. Pet Studio keeps its iframe and import drafts between routes.

## Measured comparison

macOS ARM64, Electron 45.1.0, same isolated synthetic fixture: 365 daily entries, 200 sessions, 12 sequential chat updates. Baseline is release commit `04cf4aa`. The benchmark runs the HTTP server in Electron's main process. Main CPU includes the test harness and server; it is not a daemon-only measurement. These are one-run observations, not cross-platform guarantees.

| Measurement | 0.4.0 | 0.5.0 |
| --- | ---: | ---: |
| API requests during 12 logical updates | 234 | 13 |
| Requests per live refresh | 9 | 1 |
| Heatmap cells removed during updates | 9,646 | 0 |
| First heatmap cell retained | No | Yes |
| Main process CPU during updates | 664 ms | 238 ms |
| Renderer working set at end | 294 MiB | 223 MiB |
| Main process RSS at end | 182 MiB | 179 MiB |
| Mean update-to-DOM latency | 58 ms | 128 ms |
| p95 update-to-DOM latency | 61 ms | 136 ms |
| Idle main CPU over 3 seconds | 51 ms | 44 ms |

The burst window trades roughly 70 ms of observed latency for fewer duplicate requests and less render work. Idle CPU differences are too small to infer a general improvement. Memory depends on viewport, selected pet and browser image caches.

Raw results: [dashboard-benchmark.json](dashboard-benchmark.json).

## Reproduce

Install the optional test renderer with `npm --prefix electron ci`, then run `npm run benchmark:dashboard`. It creates disposable RPC/Codex directories and an isolated Electron profile, serves only synthetic data and removes them afterward. It never reads the user's sessions or writes their settings.

To compare a checkout, set `CODEX_RPC_BENCH_ROOT` to its absolute path. Set `CODEX_RPC_BENCH_OUTPUT` to save a JSON report. Run baseline and candidate sequentially on the same machine without concurrent builds/tests. Request counts can vary slightly with filesystem polling phase. Do not compare working-set values from different Electron versions.

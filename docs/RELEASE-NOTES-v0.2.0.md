# codex-rpc v0.2.0 — Your chat. Your tools. Your little pet.

Discord Rich Presence and local analytics for Codex, with the original blue Codex Pet and a dashboard that stays on your machine.

## Highlights

- **Real typing paws.** Writing alternates hand presses on the keyboard while the pet’s head, body and laptop stay still. No whole-body jitter.
- **Six animated scenes.** Writing, thinking, patching, error, success and sleeping at 10 fps, plus a separate approval/waiting pose and pixel status badges.
- **Live workspace telemetry.** Edited files, logged +/- line counts, safe command summaries, model, operation/session timers and output tokens for the selected chat.
- **Pin a chat to Discord.** Keep one conversation selected across restarts, or follow the latest activity automatically.
- **Tool timeline and turn recaps.** Running durations, outcomes, exit codes and per-turn output-token deltas without raw arguments or stdout.
- **Local dashboard.** Dark/light themes, mobile navigation, reduced motion, seven settings tabs, history ranges, heatmaps and live stats cards.
- **Lifetime analytics.** Sessions, active hours, streaks, tools, languages, hotspots, token breakdowns and API-equivalent cost estimates.

## Fixes and reliability

- Suppress recurring blank Windows consoles from background process detection and helper launches.
- Migrate owned Windows Startup launchers to a hidden path, with script-host availability diagnostics.
- Recover from Windows directory-watch errors using polling fallback and watcher reattachment.
- Coalesce presence updates with a bounded transition budget, reconnect cleanly, and clear activity on pause.
- Keep chat counters isolated; treat incomplete/binary diffs and missing usage as unknown.
- Preserve custom image URLs and refresh bundled writing assets with a new cache version.
- Include the owner-supplied extended pricing table; invalidate cached estimates when rates change.

## Install or update

Keep Discord Desktop running. With Node 18+:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/latest/download/codex-rpc.tgz
codex-rpc setup
codex-rpc serve
```

Open **http://localhost:47474**. Setup refreshes the installed runtime and bundled asset URLs while retaining config, analytics and custom hosts. Existing Codex notifiers are preserved.

Standalone binaries, when attached below, include Node. Choose the filename matching your OS and architecture, verify its checksum, mark it executable on macOS/Linux, and run it with `setup`.

**This is a GitHub-only release.** The unscoped npm package `codex-rpc` is an unrelated project; do not use `npx codex-rpc@latest` to install this one.

## Downloads

- `codex-rpc.tgz` — stable latest-install alias, for any supported OS with Node 18+.
- `codex-rpc-0.2.0.tgz` — the same package with a versioned filename.
- `codex-rpc-0.2.0-<platform>-<arch>[.exe]` — standalone binaries for the platforms actually attached to this release.
- Platform checksum files — verify downloads before running them.

macOS standalone builds are ad-hoc signed, not notarized. Windows standalone builds are not Authenticode signed. The optional Electron shell remains available from source; this release does not include a packaged Electron installer.

## Privacy and known limits

Private mode is the default. No telemetry, cloud account or automatic analytics publishing. Public mode can share project/chat names, filenames, branches and safe command summaries; choose what you want to expose in settings.

ChatGPT Desktop detection cannot read conversations or invent hidden token/model data. Rich telemetry requires compatible local logs. Discord controls remote image animation and caching. Costs are estimates, not subscription charges; extended model rates include owner-supplied, unverified values.

Windows login startup requires Windows Script Host/VBScript; setup diagnoses unavailable engines without weakening policy. Test fresh sign-in behavior on your machine after upgrading.

See the [README](https://github.com/alphasayshello/codex-rpc#readme) for commands and the [security model](https://github.com/alphasayshello/codex-rpc/blob/main/SECURITY.md) for local-data details.

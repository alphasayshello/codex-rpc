# codex-rpc v0.3.0 — A pet for every little task

More expressive Discord presence, smoother pixel animation, and a Pet studio for the original blue Codex companion.

## New

- **Native Codex lifecycle hooks.** Setup registers 10 observational callbacks for session/turn boundaries, tools, approvals, interruption and compaction while preserving existing notifiers and hooks. Review and trust them through `/hooks` in Codex. `codex-rpc hooks [--json]` reports registration and review guidance.
- **Reliable concurrent events.** A local metadata inbox serializes hook and log updates. Call IDs deduplicate observations; late usage can refresh a chat without rewinding its activity.
- **More accurate turn recaps.** Multiple files and parsed line changes are counted per invocation. Failed/unknown edits keep applied-line counts unknown; identified late usage can refine a completed recap.
- **Installed hook fix.** The CLI correctly passes argument or stdin payloads to the hook handler, including pretty-printed native JSON and the required empty JSON response for Stop.

- **19 distinct scenes.** The seven existing live scenes are joined by reading, searching, terminal, testing, building, installing, reviewing, debugging, connecting, focus, celebrating and cozy idle. The legacy working GIF remains a writing alias.
- **20 fps loops.** Periodic movement replaces abrupt position changes. Each scene keeps one consistent original expression, with crisp pixel props and transparent backgrounds. Every GIF stays under 1 MB.
- **Real typing paws.** Alternating presses have intermediate positions at 50 ms intervals. The head, body, feet and laptop stay fixed.
- **Tool-aware art.** Available tool names and safe command summaries choose reading, searching, terminal, testing, building, installing or reviewing. Errors, approval and bounded success retain their own states. No random activity or invented progress.
- **Pet studio.** Large previews, scene search, category/family filters, dark/light/checkerboard backgrounds, pause, reduced motion, GIF/SVG downloads and copyable hosted URLs.
- **Create-a-pet prompt.** Describe a character and copy a detailed one-pass ChatGPT image prompt. Exact sheet dimensions, a 72-cell pose layout, identity consistency, transparent background and typing alignment are included, with a downloadable layout reference. Generated sheets require manual validation and integration.
- **Visual settings picker.** Choose a target state, select one of 19 thumbnails, then save. Existing custom image hosts and legacy working overrides remain supported.
- **Dashboard polish.** Clearer hierarchy, calmer surfaces, blue pet accents, refined activity chips and responsive layouts in dark and light themes.
- **Preview every scene.** `codex-rpc preview --all` prints the exact card text and asset URLs for all 19 scenes. `/api/animations` exposes the bundled catalog locally.

## Install or update

With Node 18+ and Discord Desktop running:

```sh
npm install -g https://github.com/alphasayshello/codex-rpc/releases/latest/download/codex-rpc.tgz
codex-rpc setup
codex-rpc serve
```

After setup, open **`/hooks` in Codex** and review/trust the new codex-rpc handlers. Setup does not bypass hook trust. Open **http://localhost:47474**, then **Pet studio**. Setup refreshes the installed runtime and owned asset URLs while preserving analytics, privacy preferences and custom hosts. Make sure the matching source assets have been pushed before activating the new defaults.

This is a GitHub-only release. The unscoped npm name belongs to another project; use the GitHub archive above.

## Downloads and limits

Attach `codex-rpc.tgz` (the stable latest-install alias), `codex-rpc-0.3.0.tgz`, checksums, and only the standalone binaries actually built and tested. Standalone binaries bundle Node. The optional Electron wrapper remains available from source.

Local analytics and privacy behavior remain unchanged. Rich tool scenes depend on metadata present in local logs; decorative scenes can be assigned in settings. Discord controls remote GIF animation and caching. No account token, telemetry or analytics upload is required.

See the [README](https://github.com/alphasayshello/codex-rpc#readme) and [security model](https://github.com/alphasayshello/codex-rpc/blob/main/SECURITY.md).

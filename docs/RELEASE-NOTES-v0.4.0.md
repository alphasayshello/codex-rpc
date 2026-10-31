# codex-rpc v0.4.0 — Your character, your companion

Bring your own character to Discord, or choose the new Codex Bloom companion.

- **Two base pets.** The original blue Codex Classic is joined by Codex Bloom, a supplied purple companion with ten illustrated animations. Optimized GIFs total 5.4 MB instead of 44.9 MB; each stays below 1 MB while retaining its original scene timing.
- **A reference-image ChatGPT prompt.** Attach your own character image, copy the Studio prompt, and generate one transparent eight-column, seven-row PNG. The prompt covers all seven live states, stable identity and real alternating typing hands.
- **An actual importer.** Drop a generated PNG, named GIF files or a portable JSON pet pack into Studio. Animated previews use the supplied frame sequences, without the original blue character's fixed paw rig.
- **A pet library.** Preview imported and built-in pets, then explicitly choose one for Discord. Existing custom state URLs remain overrides.
- **Export and host.** Download a portable JSON backup or a ZIP of GIFs and preview files. Custom Discord art requires a public HTTPS folder; local previews need no hosting and nothing is uploaded automatically.
- **Bounded local processing.** Worker-based PNG/GIF decoding, file/pixel/time limits, safe library paths and the dashboard's existing request protections keep imports local and inspectable.

## Install or update

With Node 18+:

```sh
npm install -g @alphasayshello/codex-rpc@latest
codex-rpc setup
codex-rpc serve
```

One-command setup: `npx @alphasayshello/codex-rpc@latest setup`. Open **http://localhost:47474**, then **Pet Studio**. Existing config, pet selection and analytics are retained. Older unscoped GitHub installations may need the [documented migration](https://github.com/alphasayshello/codex-rpc/blob/main/docs/NPM.md#upgrade-from-an-older-github-archive) to avoid a command-link collision.

In Pet Studio, choose **Codex Bloom** to preview its supplied animations, then **Use on Discord** when ready. For a custom pet, attach your character image in ChatGPT and use the new Studio prompt. Import the resulting PNG and inspect all seven state previews. Custom Discord images require publicly hosted HTTPS GIFs; local previews and exports work without hosting. No artwork is uploaded automatically.

GitHub downloads include the stable `codex-rpc.tgz` alias, versioned archive, three standalone executables, build manifest and SHA-256 checksums. Standalone builds bundle Node; macOS is ad-hoc signed and Windows is unsigned. Electron remains an optional source wrapper.

All nine macOS/Linux/Windows × Node 18/22/26 checks, both Electron suites, and native executable pet-import probes were verified before this release. GIF sizes, original artwork provenance and import limits are documented in the repository.

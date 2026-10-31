# codex-rpc v0.4.0 — Your character, your companion

Development release notes; this version has not been published to npm or GitHub Releases.

- **Two base pets.** The original blue Codex Classic is joined by Codex Bloom, a supplied purple companion with ten illustrated animations. Optimized GIFs total 5.4 MB instead of 44.9 MB; each stays below 1 MB while retaining its original scene timing.
- **A reference-image ChatGPT prompt.** Attach your own character image, copy the Studio prompt, and generate one transparent eight-column, seven-row PNG. The prompt covers all seven live states, stable identity and real alternating typing hands.
- **An actual importer.** Drop a generated PNG, named GIF files or a portable JSON pet pack into Studio. Animated previews use the supplied frame sequences, without the original blue character's fixed paw rig.
- **A pet library.** Preview imported and built-in pets, then explicitly choose one for Discord. Existing custom state URLs remain overrides.
- **Export and host.** Download a portable JSON backup or a ZIP of GIFs and preview files. Custom Discord art requires a public HTTPS folder; local previews need no hosting and nothing is uploaded automatically.
- **Bounded local processing.** Worker-based PNG/GIF decoding, file/pixel/time limits, safe library paths and the dashboard's existing request protections keep imports local and inspectable.

Source preview: clone the repository, run `npm ci`, `npm link`, `codex-rpc setup`, and `codex-rpc serve`. Open Pet Studio from the dashboard. Existing config and analytics are retained.

# Third-party artwork

The blue Codex companion is existing OpenAI artwork, not original codex-rpc artwork.

- Built-in pet ID: `codex`, “The original Codex companion.”
- Original sprite sheet: https://cdn.openai.com/c6d7b0d0-3abf-40b5-9d0c-ecd2b9364692/codex-spritesheet-v4.webp
- Product documentation: https://learn.chatgpt.com/docs/pets
- Retrieved: 2026-10-29 through the Pets plugin's built-in download operation.
- Original WebP bytes and a losslessly decoded RGBA PNG are retained in `assets/pet/source/`.
- `assets/pet/manifest.json` records SHA-256 hashes, exact source rows, frame counts and GIF timings.

Generated GIFs quantize the original frames to a shared 256-color GIF palette. PNG/SVG previews preserve source RGBA pixels, except hidden RGB under fully transparent pixels is cleared. Badges resize an original idle frame. Banner, dashboard and stat-card images embed these source-derived previews. Each scene keeps one original expression. Smooth integer translations and separately authored pixel props animate the source pose; typing articulates sampled original paw pixels within a bounded keyboard region while keeping the head, body outline, feet and laptop fixed. No replacement character is generated. The original pixel effects and gallery code are covered by MIT; source-derived pet artwork remains third-party artwork. The separate colored status-circle/check/terminal icons are original code-rendered UI glyphs covered by MIT, not third-party mascot artwork.

These images remain third-party artwork. The repository's MIT grant covers the original code and does not purport to relicense OpenAI's artwork or trademarks. The download service did not provide a separate artwork license. This independent utility is not an OpenAI product or an endorsement.

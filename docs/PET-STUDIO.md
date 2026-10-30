# Pet Studio

Open `http://localhost:47474/assets/pet/animation-gallery.html` while the dashboard is running. Browse all 19 animations, preview a scene, or copy its hosted GIF URL into Settings → Codex Pet Assets. Save settings to apply a new assignment.

## Make your own character

1. Choose **Make your own pet** in the studio.
2. Describe the character’s silhouette, colors, personality and distinctive details.
3. Download the pose/layout reference. Copy the complete prompt into ChatGPT with image generation and attach that layout plus any character reference.
4. Save the generated transparent PNG and inspect it before integrating it.

The prompt specifies a **1536 × 1872 RGBA PNG**, **8 columns × 9 rows**, with **192 × 208 pixels per cell** and no gutters. It requests consistent identity, lighting, scale and registration, plus matching start/end poses. Artwork is kept away from the upper/surrounding effect areas. The 19 runtime scenes reuse seven source poses and separately drawn effects; they are not 19 separate sprite rows.

The renderer currently selects these cells (row/column numbers start at zero):

| Scene | Row | Column |
| --- | --- | --- |
| Idle / sleeping | 0 | 1 |
| Waiting | 3 | 0 |
| Patching | 4 | 1 |
| Error | 5 | 1 |
| Thinking | 6 | 0 |
| Writing | 7 | 0 |
| Success | 8 | 1 |

Typing keeps the head, body outline, feet and laptop fixed. The sampled paw rig operates only within local cell coordinates **x67–103, y144–172**. A generated character needs matching hand/keyboard alignment or an adapted rig; a correct grid alone does not make arbitrary artwork compatible.

Image generation can miss exact dimensions, alpha or pose registration. Check the downloaded pixels, cell boundaries, face consistency, cropping and typing region. The studio supplies the prompt and layout reference; it does not upload a brief, call ChatGPT, validate a generated image, or import/replace artwork automatically. Keep the bundled source art intact until a custom sheet is deliberately integrated and its provenance and tests are updated.

The character brief lives only in the current page. Copying places the prompt on your clipboard; sending it to ChatGPT is your action. Custom HTTPS GIFs and Discord asset keys remain available independently through the normal settings fields.

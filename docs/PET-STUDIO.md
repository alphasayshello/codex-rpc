# Pet Studio

Run `codex-rpc serve`, then open **http://localhost:47474/assets/pet/animation-gallery.html**. The studio includes the original blue Codex Pet, the supplied smooth purple **Codex Bloom**, and your imported characters. Browsing a pet or a scene changes the local preview; **Use on Discord** is the explicit live-selection action.

The scene collection keeps its search, category and mood filters, keyboard navigation, backgrounds, pause and reduced-motion controls. The original pet keeps crisp pixel scaling; Bloom and custom artwork use smooth scaling. Reduced motion uses a still SVG or PNG instead of repeatedly restarting a GIF.

## Turn your image into a pet

1. Open **Make your own pet**. Optionally choose a character file for a local reference preview; this does not upload it anywhere.
2. In **ChatGPT**, attach that character image yourself. Copy the complete Pet Studio prompt into the same conversation. An optional art-direction note can suggest a small prop or mood; the attached image defines the character's identity and style.
3. Ask ChatGPT to generate the image, then download its transparent PNG. The optional **8 × 7 layout guide** shows placement only and is not another character to copy.
4. Drop the resulting PNG into **Import your own**, give the pet a name, select the **8 columns × 7 states** layout, then choose **Import & preview**.
5. Inspect all seven animated states. Browse the larger scene previews to check the face, loop seam, cropping and typing hands. Importing preserves your original file and does not replace either bundled pet.
6. For a live Discord card, host the generated GIF files publicly, enter their HTTPS folder URL, then choose **Use on Discord**.

The reference-image prompt requests a **1536 × 1344 transparent RGBA PNG**, with **8 columns × 7 rows** and **192 × 192 pixels per cell**, without gutters or extra margins. All 56 cells become frames. Rows are read left to right in this exact order:

| Row | State | Intended motion |
| --- | --- | --- |
| 0 | Idle | Gentle rest or sleeping breath. |
| 1 | Thinking | Small, deliberate contemplative gesture. |
| 2 | Waiting | Awake and attentive, waiting for a prompt or approval. |
| 3 | Writing | Real alternating hand presses; head, torso and laptop stay registered. |
| 4 | Patching | Small focused motions toward a stable file or tool prop. |
| 5 | Error | One consistent worried expression with a restrained reaction. |
| 6 | Done | A compact, pleased victory gesture. |

The importer uses every supplied frame. It does not sample a single pose, transplant the original blue pet's hands, or depend on its specific paw colors or contact coordinates. Related scene names reuse the closest core animation unless you supply a dedicated GIF. Reading, searching and reviewing can reuse thinking; terminal can reuse writing; celebrating can reuse done.

Image generation can still get a grid, face or loop wrong. The importer validates the file and state layout and can normalize reasonable image-size differences; it cannot repair inconsistent drawings, invent missing states or remove an incorrectly generated background. Correct the image in ChatGPT and import again if the animation changes identity or jitters.

## Other import formats

- **State GIFs:** select or drop multiple `.gif` files named for their states. Core names are `idle`, `thinking`, `waiting`, `writing`, `patching`, `error` and `done`. Aliases include `sleeping → idle`, `coding`/`working → writing`, `success → done`, and `deploying → installing`. Optional state-named GIFs can provide distinct extra scenes. When a state falls back to another animation, the importer reports it rather than claiming to generate new artwork.
- **Portable pet pack:** **Export pet pack** downloads a `.pet.json` file containing the animation files. Drop that file into another installation to recreate the pet locally. The visible name can be changed before importing.
- **Legacy atlas:** old 1536 × 1872, eight-column/nine-row character sheets can use the **legacy atlas** layout. This is distinct from the new reference-image format; select the matching layout after choosing the file.

PNG/GIF files are limited to 10 MB each and 48 MB total; portable JSON packs can be up to 64 MB. Unsupported, oversized, malformed, empty or unsafe inputs produce an error. Imports use a bounded background worker so drawing and encoding do not block the local dashboard. Imported files are stored under `~/.codex-rpc/pets/` with generated IDs; an upload never chooses an arbitrary filesystem path.

## Put a custom pet on Discord

The studio can preview any imported pet immediately. Discord cannot fetch files from your computer's localhost, so a custom live pet needs public HTTPS GIF URLs.

1. Preview the imported pet in the pet selector.
2. Choose **Download hosting files** to download a ZIP containing GIFs, still previews and a manifest. **Export pet pack** is for moving the pet between installations; the hosting ZIP is for a web host.
3. Extract the ZIP and upload the GIF files to a GitHub repository or another HTTPS host. Keep the filenames from the manifest unchanged. For GitHub, use the raw-file folder URL, such as `https://raw.githubusercontent.com/OWNER/REPO/main/my-pet/`.
4. Paste that folder URL into **Public GIF folder URL**, then choose **Use on Discord**. Discord resolves the images according to its own caching and animation behavior.

The supplied built-in pets already have their GitHub URL mapping and do not require a custom host. Existing per-state asset overrides remain configurable in the dashboard. A local preview is never presented as proof that Discord has downloaded the artwork.

## Privacy and standalone viewing

The reference preview and optional direction stay in the page. Copying puts the prompt on your clipboard; attaching an image and submitting it to ChatGPT are your actions. Pet Studio never calls ChatGPT, uploads a character to an image service, or publishes files to GitHub automatically. Import and live-selection requests use the dashboard's localhost Host, Origin and per-process request-token protections.

The generated gallery also supports browsing the bundled collection without the local server. Imports, exports and live controls then show a `codex-rpc serve` hint instead of pretending the local API exists. Custom pet artwork stays local until you deliberately host or export it. Only import artwork you have permission to use and share.


## Workspace preview (0.5.0 source)

Open **Pet studio** in the sidebar to use Studio inside the dashboard. It loads when first opened, follows the workspace light/dark and motion preferences, and preserves your staged files, prompt and import name when you switch pages. Offscreen previews pause automatically. Selecting a different Discord pet in Settings updates Studio's selected-pet indicator on return without discarding your preview or import draft. **Open separately** retains the standalone/offline gallery.

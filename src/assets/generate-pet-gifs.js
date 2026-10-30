#!/usr/bin/env node
// Extract existing OpenAI Codex pet frames; never invent or redraw the mascot.
// PNG decode, palette quantization and GIF89a encoding use Node built-ins only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { decodePNG, encodePNG } from "./png.js";
import { typingSprite, typingRegion } from "./typing.js";
import { buildGallery } from "./gallery.js";
import { petEffects, moveSprite, effectsVersion, effectDescriptions } from "./pixel-effects.js";
import {
  badgeSpecs,
  statusIcon,
  statusIconSVG,
  badgeGallery,
  badgeDelays,
  statusAnimationFrame,
} from "./status-icons.js";
export { statusIcon } from "./status-icons.js";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/pet",
);
export const width = 192,
  height = 208;
export const visualStates = ["idle", "thinking", "writing", "patching", "error", "done"];
export const bonusStates = ["reading", "searching", "terminal", "testing", "building", "installing", "reviewing", "debugging", "connecting", "focus", "celebrating", "idle-cozy"];
export const renderStates = [...visualStates, ...bonusStates, "waiting"];
export const states = {
  idle: { row: 0, sourceFrames: [1], sourceState: "original closed-eye sleeping pose", family: "rest" },
  thinking: { row: 6, sourceFrames: [0], sourceState: "original neutral chin-stroking pose", family: "research" },
  writing: { row: 7, sourceFrames: [0], frameCount: 64, typing: true, sourceState: "fixed original neutral laptop pose with sampled articulated paws", family: "work" },
  patching: { row: 4, sourceFrames: [1], sourceState: "original neutral focused arms-out pose", family: "work" },
  error: { row: 5, sourceFrames: [1], sourceState: "original consistent panic squint pose", family: "system" },
  done: { row: 8, sourceFrames: [1], sourceState: "original consistent smiling victory pose", family: "celebration" },
  reading: { row: 6, sourceFrames: [0], family: "research", sourceState: "original neutral chin-stroking reader" },
  searching: { row: 6, sourceFrames: [0], family: "research", sourceState: "original neutral chin-stroking searcher" },
  terminal: { row: 7, sourceFrames: [0], typing: true, family: "work", sourceState: "original fixed laptop pose with sampled articulated paws" },
  testing: { row: 7, sourceFrames: [0], typing: true, family: "work", sourceState: "original fixed laptop pose with sampled articulated paws" },
  building: { row: 4, sourceFrames: [1], family: "work", sourceState: "original neutral arms-out building pose" },
  installing: { row: 7, sourceFrames: [0], typing: true, family: "system", sourceState: "original fixed laptop pose with sampled articulated paws" },
  reviewing: { row: 6, sourceFrames: [0], family: "research", sourceState: "original neutral chin-stroking reviewer" },
  debugging: { row: 6, sourceFrames: [0], family: "research", sourceState: "original neutral chin-stroking debugger" },
  connecting: { row: 0, sourceFrames: [0], family: "system", sourceState: "original neutral standing pose" },
  focus: { row: 6, sourceFrames: [0], family: "research", sourceState: "original neutral focused pose" },
  celebrating: { row: 8, sourceFrames: [1], family: "celebration", sourceState: "original consistent smiling victory pose" },
  "idle-cozy": { row: 0, sourceFrames: [1], family: "rest", sourceState: "original closed-eye sleeping pose" },
  working: { row: 7, sourceFrames: [0], frameCount: 64, typing: true, aliasOf: "writing", sourceState: "legacy alias of fixed-body writing", family: "legacy" },
  waiting: { row: 3, sourceFrames: [0], sourceEvery: 20, sourceState: "original consistent neutral attention pose", family: "live" },
};
for (const [id, spec] of Object.entries(states)) {
  spec.label = id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  spec.description = effectDescriptions[id];
  spec.recommendedKey = spec.aliasOf || id;
  spec.frameCount ||= 80;
  spec.sourceEvery ||= 20;
  spec.frames = spec.sourceFrames.length;
  spec.fps = 20;
  spec.animation = Array.from({ length: spec.frameCount }, (_, i) => ({
    sourceFrame: Math.floor(i / spec.sourceEvery) % spec.frames, delay: 5,
  }));
  spec.delays = spec.animation.map((frame) => frame.delay);
}
export const animationCatalog = Object.entries(states).map(([id, spec]) => ({
  id, label: spec.label, description: spec.description, family: spec.family,
  recommendedKey: spec.recommendedKey, path: `/assets/pet/codex-pet-${id}.gif`,
  previewPath: `/assets/pet/codex-pet-${id}.svg`, gif: `codex-pet-${id}.gif`,
  svg: `codex-pet-${id}.svg`, fps: spec.fps, frameCount: spec.frameCount,
}));
const sourcePath = path.join(out, "source/codex-spritesheet-v4.png");
let atlas;
function source() {
  if (!atlas) {
    atlas = decodePNG(fs.readFileSync(sourcePath));
    if (atlas.width !== 1536 || atlas.height !== 1872)
      throw Error("Unexpected original Codex sprite layout");
  }
  return atlas;
}
export function sprite(state, frame = 0) {
  const spec = states[state];
  if (!spec) throw Error("Unknown pet state");
  const sheet = source(),
    rgba = Buffer.alloc(width * height * 4),
    column = spec.sourceFrames[frame % spec.frames];
  for (let y = 0; y < height; y++)
    sheet.rgba.copy(
      rgba,
      y * width * 4,
      ((spec.row * height + y) * sheet.width + column * width) * 4,
      ((spec.row * height + y) * sheet.width + (column + 1) * width) * 4,
    );
  for (let i = 0; i < rgba.length; i += 4)
    if (!rgba[i + 3]) rgba.fill(0, i, i + 4);
  return rgba;
}
export function animatedSprite(state, frame = 0) {
  const spec = states[state], index = frame % spec.animation.length;
  const elapsed = spec.animation.slice(0, index).reduce((n, f) => n + f.delay * 10, 0);
  const base = sprite(state, spec.animation[index].sourceFrame);
  if (spec.typing) return state === "writing" || state === "working" ? typingSprite(base, elapsed) : petEffects(typingSprite(base, elapsed), state, elapsed);
  return petEffects(moveSprite(base, state, elapsed), state, elapsed);
}
// Median-cut palette over all used original frames. GIF requires <=256 colors;
// transparent pixels keep index zero. Exact source pixels remain in PNG/SVG.
function paletteFor(frames) {
  const histogram = new Map();
  for (const rgba of frames)
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      const key =
        ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      const color = histogram.get(key) || { key, n: 0, r: 0, g: 0, b: 0 };
      color.n++;
      color.r += rgba[i];
      color.g += rgba[i + 1];
      color.b += rgba[i + 2];
      histogram.set(key, color);
    }
  const colors = [...histogram.values()].map((c) => ({
    ...c,
    r: c.r / c.n,
    g: c.g / c.n,
    b: c.b / c.n,
  }));
  const box = (values) => {
    const ranges = ["r", "g", "b"].map(
      (k) =>
        Math.max(...values.map((c) => c[k])) -
        Math.min(...values.map((c) => c[k])),
    );
    return { values, ranges, weight: values.reduce((n, c) => n + c.n, 0) };
  };
  const boxes = [box(colors)];
  while (boxes.length < 255) {
    let index = -1,
      score = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i],
        s = Math.max(...b.ranges) * Math.sqrt(b.weight);
      if (b.values.length > 1 && s > score) {
        score = s;
        index = i;
      }
    }
    if (index < 0) break;
    const b = boxes.splice(index, 1)[0],
      channel = ["r", "g", "b"][b.ranges.indexOf(Math.max(...b.ranges))];
    b.values.sort((a, z) => a[channel] - z[channel] || a.key - z.key);
    let weight = 0,
      split = 1;
    for (let i = 0; i < b.values.length - 1; i++) {
      weight += b.values[i].n;
      if (weight >= b.weight / 2) {
        split = i + 1;
        break;
      }
    }
    boxes.push(box(b.values.slice(0, split)), box(b.values.slice(split)));
  }
  const palette = [
    [0, 0, 0],
    ...boxes.map((b) =>
      ["r", "g", "b"].map((k) =>
        Math.round(b.values.reduce((n, c) => n + c[k] * c.n, 0) / b.weight),
      ),
    ),
  ];
  while (palette.length < 256) palette.push([0, 0, 0]);
  const lookup = new Map();
  for (const c of colors) {
    let best = 1,
      distance = Infinity;
    for (let i = 1; i <= boxes.length; i++) {
      const p = palette[i],
        d = (c.r - p[0]) ** 2 + (c.g - p[1]) ** 2 + (c.b - p[2]) ** 2;
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    lookup.set(c.key, best);
  }
  return { palette, lookup };
}
function indexFrames(frames, frameWidth, frameHeight) {
  const { palette, lookup } = paletteFor(frames);
  return { palette, frames: frames.map((rgba) => {
      const indices = Buffer.alloc(frameWidth * frameHeight);
      for (let i = 0; i < indices.length; i++) {
        const j = i * 4;
        indices[i] =
          rgba[j + 3] < 128
            ? 0
            : lookup.get(
                ((rgba[j] >> 3) << 10) |
                  ((rgba[j + 1] >> 3) << 5) |
                  (rgba[j + 2] >> 3),
              );
      }
      return indices;
    }) };
}
export function pixels(state, frame = 0) {
  const frames = states[state].animation.map((_, i) => animatedSprite(state, i));
  return indexFrames(frames, width, height).frames[frame % frames.length];
}
const u16 = (n) => Buffer.from([n & 255, n >> 8]);
function lzw(indices) {
  const bytes = [];
  let acc = 0, bitCount = 0, codeSize = 9, nextCode = 258;
  const dictionary = new Map();
  const emit = (value) => {
    acc |= value << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      bitCount -= 8;
    }
  };
  emit(256); // GIF clear code; the color table has 256 entries.
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const suffix = indices[i], key = (prefix << 8) | suffix;
    const found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (nextCode < 4096) {
      dictionary.set(key, nextCode++);
      // The encoder creates an entry one code before the decoder does.
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(256);
      dictionary.clear();
      nextCode = 258;
      codeSize = 9;
    }
    prefix = suffix;
  }
  emit(prefix);
  // Reading the final prefix can grow the decoder dictionary before the end.
  if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
  emit(257);
  if (bitCount) bytes.push(acc & 255);
  return Buffer.from(bytes);
}
export function encodeGIF(rgbaFrames, frameWidth, frameHeight, delays) {
  if (!rgbaFrames.length || rgbaFrames.length !== delays.length) throw Error("GIF frame/delay mismatch");
  if (rgbaFrames.some((frame) => frame.length !== frameWidth * frameHeight * 4)) throw Error("GIF frame dimensions mismatch");
  const { palette, frames } = indexFrames(rgbaFrames, frameWidth, frameHeight);
  const chunks = [
    Buffer.from("GIF89a"),
    u16(frameWidth),
    u16(frameHeight),
    Buffer.from([0xf7, 0, 0]),
    Buffer.from(palette.flat()),
    Buffer.from([0x21, 0xff, 11]),
    Buffer.from("NETSCAPE2.0"),
    Buffer.from([3, 1, 0, 0, 0]),
  ];
  for (const [index, frame] of frames.entries()) {
    chunks.push(
      Buffer.from([0x21, 0xf9, 4, 9]),
      u16(delays[index]),
      Buffer.from([0, 0, 0x2c]),
      u16(0),
      u16(0),
      u16(frameWidth),
      u16(frameHeight),
      Buffer.from([0, 8]),
    );
    const data = lzw(frame);
    for (let i = 0; i < data.length; i += 255) {
      const b = data.subarray(i, i + 255);
      chunks.push(Buffer.from([b.length]), b);
    }
    chunks.push(Buffer.from([0]));
  }
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}
export function gif(state) {
  const frames = states[state].animation.map((_, i) => animatedSprite(state, i));
  return encodeGIF(frames, width, height, states[state].animation.map((f) => f.delay));
}
export function statusGIF(kind) {
  return encodeGIF(badgeDelays.map((_, i) => statusAnimationFrame(kind, i)), 96, 96, badgeDelays);
}
export function svg(state, frame = 0) {
  const png = encodePNG(width, height, sprite(state, frame));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Original blue Codex Pet ${state}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString("base64")}"/></svg>`;
}
function animationContactSheet() {
  const columns = 8, sheetWidth = width * columns, rows = renderStates, rgba = Buffer.alloc(sheetWidth * height * rows.length * 4);
  for (const [row, state] of rows.entries())
    for (let column = 0; column < columns; column++) {
      const frame = animatedSprite(state, Math.floor(column * states[state].animation.length / columns));
      for (let y = 0; y < height; y++)
        frame.copy(rgba, ((row * height + y) * sheetWidth + column * width) * 4, y * width * 4, (y + 1) * width * 4);
    }
  return encodePNG(sheetWidth, height * rows.length, rgba);
}
export function generate() {
  fs.mkdirSync(out, { recursive: true });
  for (const kind of Object.keys(badgeSpecs)) {
    fs.writeFileSync(path.join(out, `codex-status-${kind}.gif`), statusGIF(kind));
    fs.writeFileSync(
      path.join(out, `codex-status-${kind}.png`),
      statusIcon(kind),
    );
    fs.writeFileSync(
      path.join(out, `codex-status-${kind}.svg`),
      statusIconSVG(kind),
    );
  }
  fs.writeFileSync(path.join(out, "status-badges.svg"), badgeGallery());
  fs.writeFileSync(path.join(out, "codex-status-done.gif"), statusGIF("waiting"));
  const gallery = buildGallery({ states, visualStates, bonusStates, effectDescriptions });
  fs.writeFileSync(path.join(out, "animation-gallery.html"), gallery.html);
  fs.writeFileSync(path.join(out, "animation-gallery.css"), gallery.css);
  fs.writeFileSync(path.join(out, "animation-gallery.js"), gallery.js);
  fs.writeFileSync(path.join(out, "animation-catalog.json"), JSON.stringify(animationCatalog, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "animation-spritesheet.png"), animationContactSheet());
  for (const state of Object.keys(states)) {
    fs.writeFileSync(path.join(out, `codex-pet-${state}.gif`), gif(state));
    fs.writeFileSync(path.join(out, `codex-pet-${state}.svg`), svg(state));
    fs.writeFileSync(
      path.join(out, `codex-pet-${state}.png`),
      encodePNG(width, height, sprite(state)),
    );
  }
  const badge = Buffer.alloc(64 * 64 * 4),
    original = sprite("idle");
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const p =
        (Math.floor((y * height) / 64) * width + Math.floor((x * width) / 64)) *
        4;
      original.copy(badge, (y * 64 + x) * 4, p, p + 4);
    }
  const badgePNG = encodePNG(64, 64, badge);
  fs.writeFileSync(path.join(out, "codex-badge.png"), badgePNG);
  fs.writeFileSync(
    path.join(out, "codex-badge.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${badgePNG.toString("base64")}"/></svg>`,
  );
  const previews = visualStates
    .map(
      (s, i) =>
        `<image href="data:image/svg+xml;base64,${Buffer.from(svg(s)).toString("base64")}" x="${i * 160 + 18}" y="58" width="124" height="174"/><text x="${i * 160 + 80}" y="255" text-anchor="middle" fill="#a4b8b0" font-family="monospace" font-size="14">${s}</text>`,
    )
    .join("");
  fs.writeFileSync(
    path.join(out, "preview-banner.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="280" viewBox="0 0 1000 280"><rect width="1000" height="280" rx="16" fill="#101820"/><text x="32" y="42" fill="#8faeff" font-family="monospace" font-size="26">codex-rpc / a little presence.</text>${previews}</svg>`,
  );
  const sha = (p) =>
    createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  fs.writeFileSync(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        petId: "codex",
        source:
          "https://cdn.openai.com/c6d7b0d0-3abf-40b5-9d0c-ecd2b9364692/codex-spritesheet-v4.webp",
        sourceSHA256: sha(path.join(out, "source/codex-spritesheet-v4.webp")),
        normalizedPNG_SHA256: sha(sourcePath),
        cell: { width, height },
        visualStates, bonusStates, renderStates, animationCatalog,
        pipeline: { fps: 20, aliases: { working: "writing", waiting: "approval attention, distinct from done" } },
        states,
        effects: { version: effectsVersion, authorship: "codex-rpc original pixel effects, not OpenAI source artwork", policy: "Non-typing poses translate at integer coordinates without cropping, with FX in alpha zero transparent space. Laptop typing scenes hold the original pose fixed outside x67..103,y144..172 and articulate sampled paw pixels above a reconstructed keyboard/chest underlay; the face, body outline, feet and laptop remain unchanged before palette quantization", articulation: { states: Object.keys(states).filter((id) => states[id].typing), region: typingRegion, interpolation: "Continuous sinusoidal paw presses sampled every 50ms; base pose and laptop remain fixed" }, states: effectDescriptions },
        previews: "Pet PNG/SVG files contain exact original source pixels without effects; animated GIFs add the separately authored effects",
        badges: { grid: 24, scale: 4, icons: badgeSpecs, aliases: { done: "waiting" }, animation: { delays: badgeDelays, transparent: true, authorship: "codex-rpc original status UI glyphs" } },
      },
      null,
      2,
    ) + "\n",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  generate();
  console.log(
    "Generated six live visual loops, twelve bonus scenes, and legacy compatibility aliases at 20 fps, animated/static pixel badges, original PNG/SVG previews, animation gallery/contact sheet and provenance manifest.",
  );
}

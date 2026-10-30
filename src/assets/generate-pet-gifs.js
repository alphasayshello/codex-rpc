#!/usr/bin/env node
// Extract existing OpenAI Codex pet frames; never invent or redraw the mascot.
// PNG decode, palette quantization and GIF89a encoding use Node built-ins only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { decodePNG, encodePNG } from "./png.js";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/pet",
);
export const width = 192,
  height = 208;
export const states = {
  working: {
    row: 7,
    frames: 6,
    delay: 14,
    sourceState: "running (laptop work)",
  },
  thinking: {
    row: 6,
    frames: 6,
    delay: 28,
    sourceState: "waiting (pondering pose)",
  },
  waiting: {
    row: 3,
    frames: 4,
    delay: 22,
    sourceState: "waving (asking for attention)",
  },
  idle: { row: 0, frames: 6, delay: 30, sourceState: "idle (calm blink)" },
};
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
    column = frame % spec.frames;
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
let indexed;
function indexedFrames() {
  if (!indexed) {
    const entries = Object.entries(states).flatMap(([state, spec]) =>
      Array.from({ length: spec.frames }, (_, i) => ({
        state,
        rgba: sprite(state, i),
      })),
    );
    const { palette, lookup } = paletteFor(entries.map((e) => e.rgba));
    indexed = { palette, frames: {} };
    for (const { state, rgba } of entries) {
      const indices = Buffer.alloc(width * height);
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
      (indexed.frames[state] ||= []).push(indices);
    }
  }
  return indexed;
}
export function pixels(state, frame = 0) {
  return indexedFrames().frames[state][frame % states[state].frames];
}
const u16 = (n) => Buffer.from([n & 255, n >> 8]);
function lzw(indices) {
  const bytes = [];
  let acc = 0,
    bits = 0;
  const code = (n) => {
    acc |= n << bits;
    bits += 9;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  for (let i = 0; i < indices.length; i += 200) {
    code(256);
    for (const value of indices.subarray(i, i + 200)) code(value);
  }
  code(257);
  if (bits) bytes.push(acc & 255);
  return Buffer.from(bytes);
}
export function gif(state) {
  const spec = states[state],
    { palette, frames } = indexedFrames();
  const chunks = [
    Buffer.from("GIF89a"),
    u16(width),
    u16(height),
    Buffer.from([0xf7, 0, 0]),
    Buffer.from(palette.flat()),
    Buffer.from([0x21, 0xff, 11]),
    Buffer.from("NETSCAPE2.0"),
    Buffer.from([3, 1, 0, 0, 0]),
  ];
  for (const frame of frames[state]) {
    chunks.push(
      Buffer.from([0x21, 0xf9, 4, 9]),
      u16(spec.delay),
      Buffer.from([0, 0, 0x2c]),
      u16(0),
      u16(0),
      u16(width),
      u16(height),
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
export function svg(state, frame = 0) {
  const png = encodePNG(width, height, sprite(state, frame));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Original blue Codex Pet ${state}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString("base64")}"/></svg>`;
}
export function generate() {
  fs.mkdirSync(out, { recursive: true });
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
  const previews = Object.keys(states)
    .map(
      (s, i) =>
        `<image href="data:image/svg+xml;base64,${Buffer.from(svg(s)).toString("base64")}" x="${i * 190 + 18}" y="58" width="160" height="174"/><text x="${i * 190 + 98}" y="255" text-anchor="middle" fill="#a4b8b0" font-family="monospace" font-size="14">${s}</text>`,
    )
    .join("");
  fs.writeFileSync(
    path.join(out, "preview-banner.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="280" viewBox="0 0 800 280"><rect width="800" height="280" rx="16" fill="#101820"/><text x="32" y="42" fill="#8faeff" font-family="monospace" font-size="26">codex-rpc / a little presence.</text>${previews}</svg>`,
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
        states,
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
    "Extracted original blue Codex Pet: four looping GIFs, PNG/SVG previews, badge, banner and provenance manifest.",
  );
}

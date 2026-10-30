#!/usr/bin/env node
// Deterministic, dependency-free GIF89a encoder. Frequent LZW CLEAR codes keep
// code width fixed; larger files are a deliberate tradeoff for inspectability.
import fs from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/pet",
);
const colors = [
  "#101820",
  "#263943",
  "#e6e2d5",
  "#a4b8b0",
  "#67efbd",
  "#f9ce78",
  "#fffaf0",
  "#587283",
];
const scale = 4,
  size = 48;
export function pixels(state, frame) {
  const p = Array(size * size).fill(0);
  const rect = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (i >= 0 && j >= 0 && i < size && j < size) p[j * size + i] = c;
  };
  const bob = state === "idle" ? 1 : frame % 4 === 0 ? -1 : 0;
  rect(10, 40, 28, 2, 1);
  rect(17, 29 + bob, 15, 10, 3);
  rect(14, 34, 5, 4, 2);
  rect(31, 34, 5, 4, 2);
  rect(14, 15 + bob, 22, 15, 2);
  rect(12, 17 + bob, 2, 10, 3);
  rect(36, 17 + bob, 2, 10, 3);
  rect(15, 11 + bob, 5, 4, 2);
  rect(30, 11 + bob, 5, 4, 2);
  rect(17, 10 + bob, 2, 2, 4);
  rect(32, 10 + bob, 2, 2, 4);
  rect(17, 19 + bob, 16, 8, 0);
  const blink = state === "idle" || frame === 5;
  rect(19, 21 + bob, 3, blink ? 1 : 3, 4);
  rect(28, 21 + bob, 3, blink ? 1 : 3, 4);
  rect(24, 26 + bob, 3, 1, 3);
  if (state === "working" || state === "waiting") {
    rect(16, 32, 20, 9, 7);
    rect(18, 33, 16, 6, 0);
    rect(12, 41, 28, 2, 3);
    rect(22, 35, 3, 1, 4);
    rect(25, 36, 3, 1, 4);
    if (state === "working") {
      rect(frame % 2 ? 14 : 34, 35, 3, 2, 2);
      rect(5 + (frame % 3), 16 - (frame % 3), 2, 2, 5);
      rect(39, 22 - (frame % 4), 2, 2, 4);
      rect(7, 24, 1, 3, 5);
    }
  }
  if (state === "thinking") {
    rect(35, 10 - (frame % 2), 3, 3, 3);
    rect(38, 4, 8, 5, frame % 2 ? 4 : 3);
    rect(40, 3, 4, 7, frame % 2 ? 4 : 3);
    for (let i = 0; i < 3; i++) rect(39 + i * 2, 6, 1, 1, 0);
    rect(8, 13, 2, 2, frame % 2 ? 4 : 7);
  }
  if (state === "waiting") {
    rect(36, 4, 9, 8, 6);
    rect(35, 12, 3, 2, 6);
    rect(39, 6, 4, 1, 0);
    rect(42, 7, 1, 2, 0);
    rect(40, 9, 2, 1, 0);
    if (frame % 4 < 3) rect(40, 11, 1, 1, 0);
  }
  if (state === "idle") {
    const y = 12 - (frame % 4);
    rect(36, y, 5, 1, 4);
    rect(39, y + 1, 1, 1, 4);
    rect(38, y + 2, 1, 1, 4);
    rect(36, y + 3, 5, 1, 4);
    rect(42, y - 5, 3, 1, 3);
    rect(43, y - 4, 1, 1, 3);
    rect(42, y - 3, 3, 1, 3);
  }
  return p;
}
export function svg(state, frame = 0) {
  const p = pixels(state, frame);
  let shapes = "";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (p[y * size + x])
        shapes += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[p[y * size + x]]}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="192" height="192" role="img" aria-label="Codex Pet ${state}" shape-rendering="crispEdges"><rect width="48" height="48" fill="${colors[0]}"/>${shapes}</svg>`;
}
function u16(n) {
  return Buffer.from([n & 255, n >> 8]);
}
export function gif(state) {
  const chunks = [
    Buffer.from("GIF89a"),
    u16(size * scale),
    u16(size * scale),
    Buffer.from([0xf2, 0, 0]),
    Buffer.from(
      colors.flatMap((c) =>
        [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
      ),
    ),
    Buffer.from([0x21, 0xff, 11]),
    Buffer.from("NETSCAPE2.0"),
    Buffer.from([3, 1, 0, 0, 0]),
  ];
  for (let f = 0; f < 8; f++) {
    chunks.push(
      Buffer.from([0x21, 0xf9, 4, 4, 18, 0, 0, 0, 0x2c]),
      u16(0),
      u16(0),
      u16(size * scale),
      u16(size * scale),
      Buffer.from([0, 3]),
    );
    const p = pixels(state, f),
      data = []; // 4-bit codes: CLEAR(8), color, repeated. END(9).
    for (let y = 0; y < size * scale; y++)
      for (let x = 0; x < size * scale; x++)
        data.push(
          8 | (p[Math.floor(y / scale) * size + Math.floor(x / scale)] << 4),
        );
    data.push(9);
    for (let i = 0; i < data.length; i += 255) {
      const b = Buffer.from(data.slice(i, i + 255));
      chunks.push(Buffer.from([b.length]), b);
    }
    chunks.push(Buffer.from([0]));
  }
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}
function badgePNG() {
  const crc = (b) => {
    let c = 0xffffffff;
    for (const v of b) {
      c ^= v;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const label = Buffer.from(type),
      len = Buffer.alloc(4),
      check = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    check.writeUInt32BE(crc(Buffer.concat([label, data])));
    return Buffer.concat([len, label, data, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const data = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const on =
        (x >= 16 && x <= 30 && Math.abs(y - 30 - (x - 23)) <= 2) ||
        (x >= 16 && x <= 30 && Math.abs(y - 30 + (x - 23)) <= 2) ||
        (x >= 34 && x < 49 && y >= 40 && y < 44);
      const color = on ? [103, 239, 189] : [16, 24, 32];
      for (let i = 0; i < 3; i++) data[y * 193 + 1 + x * 3 + i] = color[i];
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(data)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function generate() {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "codex-badge.png"), badgePNG());
  fs.writeFileSync(
    path.join(out, "codex-badge.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#101820"/><path d="m17 19 12 12-12 12m18 0h14" fill="none" stroke="#67efbd" stroke-width="5"/></svg>',
  );
  for (const state of ["working", "thinking", "waiting", "idle"]) {
    fs.writeFileSync(path.join(out, `codex-pet-${state}.gif`), gif(state));
    fs.writeFileSync(path.join(out, `codex-pet-${state}.svg`), svg(state));
  }
  const previews = ["working", "thinking", "waiting", "idle"]
    .map(
      (s, i) =>
        `<image href="data:image/svg+xml;base64,${Buffer.from(svg(s)).toString("base64")}" x="${i * 190 + 18}" y="70" width="160" height="160"/><text x="${i * 190 + 98}" y="250" text-anchor="middle" fill="#a4b8b0" font-family="monospace" font-size="14">${s}</text>`,
    )
    .join("");
  fs.writeFileSync(
    path.join(out, "preview-banner.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="280" viewBox="0 0 800 280"><rect width="800" height="280" rx="16" fill="#101820"/><text x="32" y="42" fill="#67efbd" font-family="monospace" font-size="26">codex-rpc / a little presence.</text>${previews}</svg>`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  generate();
  console.log("Generated four animated GIFs, four SVGs, and preview banner.");
}

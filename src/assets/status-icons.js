// Original UI glyphs on a 24px grid, enlarged 4x without antialiasing.
// These are status badges; the OpenAI mascot artwork is never redrawn.
import { encodePNG } from "./png.js";
export const badgeSpecs = {
  working: { color: [105, 137, 233], label: "Command" },
  thinking: { color: [152, 121, 211], label: "Thinking" },
  waiting: { color: [103, 184, 132], label: "Done" },
  idle: { color: [123, 139, 151], label: "Idle" },
  approval: { color: [219, 169, 78], label: "Approval" },
  editing: { color: [84, 173, 190], label: "Editing" },
  reading: { color: [110, 151, 207], label: "Reading" },
  review: { color: [92, 177, 161], label: "Review" },
  ready: { color: [109, 173, 145], label: "Ready" },
  error: { color: [209, 111, 117], label: "Error" },
};
export function statusIconPixels(kind) {
  const spec = badgeSpecs[kind];
  if (!spec) throw Error("Unknown status badge");
  const size = 24,
    rgba = Buffer.alloc(size * size * 4),
    ink = [248, 252, 249],
    edge = [22, 30, 35],
    base = spec.color;
  const pixel = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = c[0];
    rgba[i + 1] = c[1];
    rgba[i + 2] = c[2];
    rgba[i + 3] = 255;
  };
  const rect = (x, y, w, h, c = ink) => {
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++) pixel(px, py, c);
  };
  const line = (x, y, tx, ty, width = 2) => {
    const steps = Math.max(Math.abs(tx - x), Math.abs(ty - y));
    for (let i = 0; i <= steps; i++)
      rect(
        Math.round(x + ((tx - x) * i) / steps),
        Math.round(y + ((ty - y) * i) / steps),
        width,
        width,
      );
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = (x - 11.5) ** 2 + (y - 11.5) ** 2;
      if (d > 11.5 ** 2) continue;
      const color =
        d > 10.25 ** 2
          ? edge
          : base.map((v) =>
              Math.max(0, Math.min(255, v + (y < 6 ? 9 : y > 17 ? -15 : 0))),
            );
      pixel(x, y, color);
    }
  if (kind === "waiting") {
    line(5, 11, 9, 15);
    line(9, 15, 17, 7);
  } else if (kind === "working") {
    line(5, 7, 9, 11);
    line(9, 11, 5, 15);
    rect(12, 15, 6, 2);
  } else if (kind === "thinking") {
    for (const x of [5, 10, 15]) rect(x, 10, 3, 3);
  } else if (kind === "approval") {
    rect(11, 5, 2, 9);
    rect(11, 17, 2, 2);
  } else if (kind === "editing") {
    line(7, 15, 15, 7, 3);
    rect(5, 18, 2, 2);
    rect(16, 5, 3, 3);
  } else if (kind === "reading") {
    rect(6, 5, 12, 15);
    rect(8, 7, 8, 11, base);
    rect(9, 9, 6, 2);
    rect(9, 13, 6, 2);
  } else if (kind === "review") {
    for (let y = 5; y <= 15; y++)
      for (let x = 5; x <= 15; x++) {
        const d = (x - 10) ** 2 + (y - 10) ** 2;
        if (d <= 4.8 ** 2 && d >= 2.7 ** 2) pixel(x, y, ink);
      }
    line(14, 14, 18, 18);
  } else if (kind === "ready") {
    rect(5, 6, 14, 11);
    rect(7, 8, 10, 7, base);
    rect(7, 17, 3, 2);
    rect(7, 19, 2, 1);
    for (const x of [8, 11, 14]) rect(x, 11, 1, 2);
  } else if (kind === "error") {
    line(6, 6, 16, 16);
    line(16, 6, 6, 16);
  } else {
    rect(7, 6, 3, 12);
    rect(14, 6, 3, 12);
  }
  return rgba;
}
export function statusIcon(kind) {
  const small = statusIconPixels(kind),
    rgba = Buffer.alloc(96 * 96 * 4);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++) {
      const i = (Math.floor(y / 4) * 24 + Math.floor(x / 4)) * 4;
      small.copy(rgba, (y * 96 + x) * 4, i, i + 4);
    }
  return encodePNG(96, 96, rgba);
}
export function statusIconSVG(kind) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" shape-rendering="crispEdges" role="img" aria-label="${badgeSpecs[kind].label} pixel badge"><image width="96" height="96" style="image-rendering:pixelated" href="data:image/png;base64,${statusIcon(kind).toString("base64")}"/></svg>`;
}
export function badgeGallery() {
  const cells = Object.entries(badgeSpecs)
    .map(([kind, spec], i) => {
      const x = 30 + (i % 5) * 145,
        y = 20 + Math.floor(i / 5) * 130;
      return `<image x="${x + 25}" y="${y}" width="72" height="72" href="data:image/png;base64,${statusIcon(kind).toString("base64")}" style="image-rendering:pixelated"/><text x="${x + 61}" y="${y + 95}" text-anchor="middle" fill="#b6c6cd" font-family="monospace" font-size="12">${spec.label}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="290" viewBox="0 0 800 290"><rect width="800" height="290" rx="12" fill="#101820"/>${cells}</svg>`;
}

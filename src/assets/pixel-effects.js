// codex-rpc motion composition uses the original blue pet as an unchanged sprite.
// Integer translation preserves its identity; independent FX never cover pixels.
import { drawBonusScene } from "./scene-props.js";
export const effectsVersion = "pixel-fx-4";
const blue = [116, 161, 245], pale = [229, 240, 255], mint = [126, 232, 188], pink = [247, 139, 153];
export function motionOffset(original, state, elapsedMs, width = 192, height = 208) {
  const phase = elapsedMs / 4000 * Math.PI * 2;
  let dx = 0, dy = 0;
  if (["working", "writing", "terminal", "testing", "installing"].includes(state)) {
    dx = 0; dy = 0;
  } else if (state === "thinking") {
    dx = Math.round(Math.sin(phase) * 6); dy = Math.round(-1 + Math.cos(phase * 2));
  } else if (state === "patching" || state === "building") {
    dx = Math.round(Math.sin(phase) * 2); dy = Math.round(-2.5 * (1 - Math.cos(phase * 2)));
  } else if (state === "error") {
    dx = Math.round(Math.sin(phase * 8) * 2); dy = Math.round(-1 + Math.cos(phase * 4));
  } else if (state === "done") {
    dx = Math.round(Math.sin(phase) * 3); dy = Math.round(-4 * (1 - Math.cos(phase * 2)));
  } else if (state === "celebrating") {
    dx = Math.round(Math.sin(phase) * 2); dy = Math.round(-2 * (1 - Math.cos(phase * 2)));
  } else if (state === "idle" || state === "idle-cozy") {
    dy = Math.round(Math.sin(phase) * (state === "idle" ? 2 : 1));
  } else dy = Math.round(-1 + Math.cos(phase));
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    if (original[(y * width + x) * 4 + 3]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  return { dx: Math.max(-minX, Math.min(width - 1 - maxX, dx)), dy: Math.max(-minY, Math.min(height - 1 - maxY, dy)) };
}
export function moveSprite(original, state, elapsedMs, width = 192, height = 208) {
  const { dx, dy } = motionOffset(original, state, elapsedMs, width, height), rgba = Buffer.alloc(original.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4;
    if (original[from + 3]) original.copy(rgba, ((y + dy) * width + x + dx) * 4, from, from + 4);
  }
  return rgba;
}
export function petEffects(original, state, elapsedMs, width = 192, height = 208) {
  const rgba = Buffer.from(original), turn = ((elapsedMs % 4000) + 4000) % 4000 / 4000, phase = turn * Math.PI * 2;
  const rect = (x, y, w, h, color) => {
    x = Math.round(x); y = Math.round(y);
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      if (!original[i + 3]) rgba.set([...color, 255], i);
    }
  };
  const glyph = (rows, x, y, scale = 2, color = pale) => rows.forEach((row, dy) => [...row].forEach((on, dx) => {
    if (on === "#") rect(x + dx * scale, y + dy * scale, scale, scale, color);
  }));
  const spark = (x, y, color = pale) => { rect(x + 3, y, 2, 8, color); rect(x, y + 3, 8, 2, color); };
  const card = (x, y, color = pale, patch = false) => {
    rect(x, y, 17, 22, [44, 62, 103]); rect(x + 2, y + 2, 13, 18, color);
    if (patch) {
      rect(x + 5, y + 6, 7, 2, [42, 130, 101]); rect(x + 8, y + 3, 2, 8, [42, 130, 101]);
      rect(x + 5, y + 14, 7, 2, [172, 69, 89]);
    } else { rect(x + 4, y + 6, 8, 2, blue); rect(x + 4, y + 11, 6, 2, blue); }
  };
  if (drawBonusScene({ state, phase, turn, rect, glyph, spark, card })) return rgba;
  if (state === "working" || state === "writing") return rgba;
  if (state === "thinking") {
    for (let i = 0; i < 6; i++) {
      const a = phase + i * Math.PI / 3;
      rect(160 + Math.cos(a) * 14, 18 + Math.sin(a) * 14, 3, 3, i % 2 ? pale : blue);
    }
    glyph([".###.", "#...#", "...#.", "..#..", ".....", "..#.."], 12, 22 + Math.sin(phase) * 3, 2, mint);
  } else if (state === "patching") {
    const slide = (1 - Math.cos(phase)) / 2;
    card(7 + slide * 18, 10 + Math.sin(phase) * 3, mint, true);
    card(165 - slide * 14, 10 - Math.sin(phase) * 3, pale, true);
    rect(4, 197, 184, 3, [72, 94, 145]);
    if (slide > 0.8) glyph(["....#", "...#.", "#.#..", ".#..."], 9, 158, 2, mint);
  } else if (state === "error") {
    for (let i = 0; i < 3; i++) {
      const a = phase + i * Math.PI * 2 / 3, x = 56 + i * 30 + Math.sin(a) * 5, y = 12 + Math.cos(a) * 10;
      rect(x + 3, y, 10, 3, [158, 168, 194]); rect(x, y + 3, 16, 5, [132, 147, 177]); rect(x + 3, y + 8, 10, 2, [106, 122, 158]);
    }
    glyph(["##", "##", "##", "##", "..", "##"], 177, 72 + Math.sin(phase * 2) * 2, 2, pink);
  } else if (state === "done") {
    for (let i = 0; i < 10; i++) {
      const a = phase + i * Math.PI * 2 / 10;
      rect(95 + Math.cos(a) * (75 + i % 3 * 4), 70 + Math.sin(a) * 60, 2 + i % 2 * 2, 2, [mint, pink, blue, pale][i % 4]);
    }
  } else if (state === "waiting") {
    glyph([".########.", "#........#", "#........#", "#........#", ".#######..", "...#......"], 157, 7 + Math.sin(phase) * 2, 2, blue);
    for (let i = 0; i < 3; i++) rect(162 + i * 4, 12 + Math.sin(phase + i) * 2, 2, 2, pale);
  } else if (state === "idle") {
    glyph(["#####", "...#.", "..#..", ".#...", "#####"], 157, 24 - Math.sin(phase) * 4, 2, blue);
    glyph(["###", ".#.", "###"], 176, 10 - Math.sin(phase + 0.5) * 3, 2, pale);
  }

  return rgba;
}
export const effectDescriptions = {
  idle: "Soft sleeping breath and floating Z pixels in a seamless loop",
  thinking: "Smooth chin-stroking pace with a rotating planning constellation",
  writing: "Stationary head and laptop with alternating articulated paw presses on the keyboard",
  working: "Legacy alias of writing: steady seated keyboard typing",
  patching: "Focused stance and smooth sliding plus/minus cards above a pixel workbench",
  error: "Consistent original panic squint shakes beneath rising smoke and an alert glyph",
  done: "Smiling victory bounce through a seamless orbit of colorful confetti",
  waiting: "Gentle attention pose with bobbing speech-bubble dots, distinct from success",
  reading: "An open pixel book with softly turning pages and a reading marker",
  searching: "A scanning search grid with an orbiting magnifier and highlighted result",
  terminal: "Steady real paw typing beside a tiny terminal with animated command rows",
  testing: "A test matrix lights passing checks while the seated pet types",
  building: "Interlocking pixel blocks stack and lift in a smooth construction rhythm",
  installing: "An install arrow floats over a smoothly filling package progress bar",
  reviewing: "A two-color diff sheet with a moving review highlight",
  debugging: "A magnifying glass sweeps a tiny bug and diagnostic pixels",
  connecting: "Linked network nodes exchange a smoothly traveling connection signal",
  focus: "A quiet focused pose surrounded by a sparse rotating halo",
  celebrating: "A restrained smiling bounce with golden stars and soft confetti",
  "idle-cozy": "A sleepy blue companion under a crescent moon and twinkling stars",
};

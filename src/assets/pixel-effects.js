// codex-rpc motion composition uses the original blue pet as an unchanged sprite.
// Integer translation preserves its identity; independent FX never cover pixels.
export const effectsVersion = "pixel-fx-3";
const blue = [116, 161, 245], pale = [229, 240, 255], mint = [126, 232, 188], pink = [247, 139, 153];
export function motionOffset(original, state, elapsedMs, width = 192, height = 208) {
  const step = Math.floor(elapsedMs / 100), t = elapsedMs / 1000;
  let dx = 0, dy = 0;
  if (state === "working" || state === "writing") {
    dx = 0; dy = 0;
  } else if (state === "thinking") {
    dx = Math.round(Math.sin(t * Math.PI * 2 / 2) * 8); dy = Math.round(-Math.abs(Math.sin(t * Math.PI * 2)) * 4);
  } else if (state === "patching") {
    dx = [0, 0, 4, 4, 0, -2][step % 6]; dy = [0, -3, -9, -6, 0, 0][step % 6];
  } else if (state === "error") {
    dx = [-5, 4, -3, 5, -4, 3, -2, 2][step % 8]; dy = step % 2 ? -5 : -1;
  } else if (state === "done") {
    const celebrating = step % 40 < 28;
    dx = celebrating ? Math.round(Math.sin(t * Math.PI * 2) * 5) : 0;
    dy = celebrating ? Math.round(-Math.abs(Math.sin(t * Math.PI * 2)) * 10) : 0;
  } else if (state === "waiting") {
    dx = Math.round(Math.sin(t * Math.PI) * 2); dy = Math.round(-Math.abs(Math.sin(t * Math.PI)) * 3);
  } else dy = Math.round(Math.sin(t * Math.PI / 3) * 2);
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
  const rgba = Buffer.from(original), step = Math.floor(elapsedMs / 100), phase = step % 40;
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
  if (state === "working" || state === "writing") {
    // Writing motion is confined to articulated paws and keyboard contact.
    return rgba;
  } else if (state === "thinking") {
    // Pacing plus a rotating pixel gear / planning glyph constellation.
    const angle = step * Math.PI / 8;
    for (let i = 0; i < 6; i++) {
      const a = angle + i * Math.PI / 3;
      rect(160 + Math.cos(a) * 14, 18 + Math.sin(a) * 14, 3, 3, i % 2 ? pale : blue);
    }
    glyph([".###.", "#...#", "...#.", "..#..", ".....", "..#.."], 12, 24 + Math.sin(angle) * 4, 2, mint);
    for (let i = 0; i < 3; i++) rect(176 + i * 4, 70 + (step * 3 + i * 12) % 45, 2, 2, blue);
  } else if (state === "patching") {
    const progress = step % 18;
    card(7 + progress, 10 + Math.round(Math.sin(progress / 18 * Math.PI) * 12), mint, true);
    card(165 - progress, 32 - progress * 2, pale, true);
    rect(4, 197, 184, 3, [72, 94, 145]);
    const stamp = progress > 12 && progress < 16;
    if (stamp) { spark(174, 153, mint); glyph(["....#", "...#.", "#.#..", ".#..."], 9, 158, 2, mint); }
  } else if (state === "error") {
    // A consistent panic expression; no rapid rotation through different faces.
    for (let i = 0; i < 3; i++) {
      const rise = (step * 3 + i * 11) % 31, x = 56 + i * 30 + Math.round(Math.sin((step + i) / 3) * 5), y = 29 - rise;
      rect(x + 3, y, 10, 3, [158, 168, 194]); rect(x, y + 3, 16, 5, [132, 147, 177]); rect(x + 3, y + 8, 10, 2, [106, 122, 158]);
    }
    glyph(["##", "##", "##", "##", "..", "##"], 177, 72 + (step % 2) * 2, 2, pink);
    for (let i = 0; i < 3; i++) rect(3, 94 + i * 11, step % 2 ? 9 : 14, 2, pink);
  } else if (state === "done") {
    // Victory jumps with falling confetti; final frames settle without FX spam.
    if (phase < 30) for (let i = 0; i < 12; i++) {
      const x = (17 + i * 43 + step * (i % 2 ? -1 : 1) + 192) % 192, y = (i * 19 + step * 5) % 175;
      rect(x, y, i % 3 === 0 ? 4 : 2, i % 3 === 0 ? 2 : 4, [mint, pink, blue, pale][i % 4]);
    }
    if (phase < 24 && step % 5 === 1) { spark(12, 64, mint); spark(174, 88, pale); }
  } else if (state === "waiting") {
    glyph([".########.", "#........#", "#........#", "#........#", ".#######..", "...#......"], 157, 7, 2, blue);
    for (let i = 0; i < Math.min(3, Math.floor(step / 3) % 6 + 1); i++) rect(162 + i * 4, 12, 2, 2, pale);
  } else if (state === "idle") {
    const rise = (step % 30) / 3;
    glyph(["#####", "...#.", "..#..", ".#...", "#####"], 157, 28 - rise, 2, blue);
    glyph(["###", ".#.", "###"], 176, 12 - rise / 2, 2, pale);
  }
  return rgba;
}
export const effectDescriptions = {
  idle: "Original closed-eye pose breathes while Z pixels rise in a slow snoozing loop",
  thinking: "Chin-stroking pet paces with a rotating planning gear and floating question glyphs",
  writing: "Stationary head and laptop with alternating articulated paw presses on the keyboard",
  working: "Legacy alias of writing: steady seated keyboard typing",
  patching: "Focused arms and body stamp sliding plus/minus file cards onto a pixel workbench",
  error: "Consistent original panic squint shakes beneath rising smoke and an alert glyph",
  done: "Original smiling victory poses jump through confetti, then briefly settle",
  waiting: "Approval/attention wave with accumulating speech-bubble dots, distinct from success",
};

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  gif,
  svg,
  pixels,
  sprite,
  states,
} from "../src/assets/generate-pet-gifs.js";
// Independent GIF container + LZW reader validates decoded pixel counts and
// frame differences, rather than merely looking for a GIF header.
function decode(data) {
  let pos = 6;
  const width = data.readUInt16LE(pos),
    height = data.readUInt16LE(pos + 2),
    packed = data[pos + 4];
  pos += 7;
  if (packed & 128) pos += 3 * 2 ** ((packed & 7) + 1);
  const frames = [],
    delays = [];
  let delay = 0;
  let loops = false;
  const blocks = () => {
    const chunks = [];
    while (data[pos]) {
      const n = data[pos++];
      chunks.push(data.subarray(pos, pos + n));
      pos += n;
    }
    pos++;
    return Buffer.concat(chunks);
  };
  while (pos < data.length) {
    const type = data[pos++];
    if (type === 0x3b) break;
    if (type === 0x21) {
      const label = data[pos++];
      const b = blocks();
      if (label === 0xf9) delay = b.readUInt16LE(1);
      if (label === 0xff && b.includes(Buffer.from("NETSCAPE2.0")))
        loops = true;
      continue;
    }
    assert.equal(type, 0x2c);
    const w = data.readUInt16LE(pos + 4),
      h = data.readUInt16LE(pos + 6),
      flags = data[pos + 8];
    pos += 9;
    if (flags & 128) pos += 3 * 2 ** ((flags & 7) + 1);
    const min = data[pos++],
      clear = 1 << min,
      end = clear + 1,
      bytes = blocks();
    let bits = 0,
      index = 0,
      codeSize = min + 1,
      dict = [],
      previous = null,
      decoded = [];
    const reset = () => {
      dict = Array.from({ length: clear }, (_, i) => [i]);
      dict.push([], []);
      codeSize = min + 1;
      previous = null;
    };
    reset();
    while (index * 8 + bits < bytes.length * 8) {
      let code = 0;
      for (let b = 0; b < codeSize; b++) {
        code |= ((bytes[index] >> bits) & 1) << b;
        bits++;
        if (bits === 8) {
          bits = 0;
          index++;
        }
      }
      if (code === clear) {
        reset();
        continue;
      }
      if (code === end) break;
      const sequence =
        dict[code] ||
        (code === dict.length && previous ? [...previous, previous[0]] : null);
      assert.ok(sequence);
      decoded.push(...sequence);
      if (previous) {
        dict.push([...previous, sequence[0]]);
        if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
      }
      previous = sequence;
    }
    assert.equal(decoded.length, w * h);
    frames.push(Buffer.from(decoded));
    delays.push(delay);
  }
  return { width, height, frames, loops, delays };
}
test("four deterministic GIF89a files contain decoded original-sprite looping animation frames; SVG previews exist", () => {
  for (const state of ["working", "thinking", "waiting", "idle"]) {
    const data = gif(state),
      parsed = decode(data);
    assert.equal(parsed.width, 192);
    assert.equal(parsed.height, 208);
    assert.equal(parsed.frames.length, states[state].frames);
    assert.deepEqual(parsed.delays, states[state].delays);
    assert.ok(parsed.loops);
    assert.ok(new Set(parsed.frames.map((b) => b.toString("base64"))).size > 1);
    assert.deepEqual(
      data,
      fs.readFileSync(
        new URL(`../assets/pet/codex-pet-${state}.gif`, import.meta.url),
      ),
    );
    assert.match(svg(state), /^<svg/);
    assert.ok(
      fs.existsSync(
        new URL(`../assets/pet/codex-pet-${state}.svg`, import.meta.url),
      ),
    );
  }
});

test("mascot pixels come from the official blue Codex atlas, not a substitute drawing", async () => {
  const { createHash } = await import("node:crypto");
  const { decodePNG } = await import("../src/assets/png.js");
  const source = fs.readFileSync(
    new URL("../assets/pet/source/codex-spritesheet-v4.webp", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "5cd7af9cfeae88fe9c6e47a72460e0dc4c6fb04baf7fdc6cca14a212f0bf44d1",
  );
  const atlas = decodePNG(
    fs.readFileSync(
      new URL("../assets/pet/source/codex-spritesheet-v4.png", import.meta.url),
    ),
  );
  for (const [state, row, frames] of [
    ["working", 7, 8],
    ["thinking", 6, 4],
    ["waiting", 3, 7],
    ["idle", 0, 7],
  ]) {
    assert.equal(states[state].row, row);
    assert.equal(states[state].frames, frames);
    for (let frame = 0; frame < frames; frame++) {
      const extracted = sprite(state, frame);
      for (let y = 0; y < 208; y++)
        for (let x = 0; x < 192; x++) {
          const src =
              ((row * 208 + y) * atlas.width +
                states[state].sourceFrames[frame] * 192 +
                x) *
              4,
            dst = (y * 192 + x) * 4;
          assert.equal(extracted[dst + 3], atlas.rgba[src + 3]);
          if (extracted[dst + 3])
            assert.deepEqual(
              extracted.subarray(dst, dst + 3),
              atlas.rgba.subarray(src, src + 3),
            );
        }
    }
    const preview = decodePNG(
      fs.readFileSync(
        new URL(`../assets/pet/codex-pet-${state}.png`, import.meta.url),
      ),
    );
    assert.deepEqual(preview.rgba, sprite(state));
  }
});

test("work animation keeps a steady face with one blink over a long loop", () => {
  assert.deepEqual(states.working.sourceFrames, [0, 4, 0, 4, 0, 2, 0, 4]);
  assert.equal(states.working.sourceFrames.filter((n) => n === 2).length, 1);
  assert.ok(states.working.delays.reduce((n, d) => n + d, 0) >= 500);
  for (const spec of Object.values(states)) {
    assert.equal(spec.frames, spec.delays.length);
    assert.ok(spec.delays.every((d) => d >= 12));
  }
});

test("ten status badges use exact 4x pixel blocks and binary alpha", async () => {
  const { badgeSpecs, statusIcon, statusIconPixels } =
    await import("../src/assets/status-icons.js");
  const { decodePNG } = await import("../src/assets/png.js");
  assert.equal(Object.keys(badgeSpecs).length, 10);
  for (const kind of Object.keys(badgeSpecs)) {
    const original = statusIconPixels(kind),
      decoded = decodePNG(statusIcon(kind));
    assert.equal(decoded.width, 96);
    assert.equal(decoded.height, 96);
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++) {
        const i = (y * 96 + x) * 4,
          j = (Math.floor(y / 4) * 24 + Math.floor(x / 4)) * 4;
        for (let k = 0; k < 4; k++)
          assert.equal(decoded.rgba[i + k], original[j + k]);
        assert.ok(decoded.rgba[i + 3] === 0 || decoded.rgba[i + 3] === 255);
      }
    assert.ok(
      fs.existsSync(
        new URL(`../assets/pet/codex-status-${kind}.svg`, import.meta.url),
      ),
    );
  }
});

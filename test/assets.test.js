import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  gif,
  svg,
  pixels,
  sprite,
  states,
  animatedSprite,
  statusGIF,
  encodeGIF,
  visualStates,
} from "../src/assets/generate-pet-gifs.js";
// Independent GIF container + LZW reader validates decoded pixel counts and
// frame differences, rather than merely looking for a GIF header.
function decode(data) {
  let pos = 6;
  const width = data.readUInt16LE(pos),
    height = data.readUInt16LE(pos + 2),
    packed = data[pos + 4];
  pos += 7;
  const palette = packed & 128 ? Array.from({ length: 2 ** ((packed & 7) + 1) }, (_, i) => [...data.subarray(pos + i * 3, pos + i * 3 + 3)]) : [];
  if (packed & 128) pos += 3 * 2 ** ((packed & 7) + 1);
  const frames = [],
    delays = [], controls = [];
  let delay = 0;
  let control;
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
      if (label === 0xf9) {
        delay = b.readUInt16LE(1);
        control = { transparent: !!(b[0] & 1), disposal: (b[0] >> 2) & 7, transparentIndex: b[3] };
      }
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
    controls.push(control);
  }
  return { width, height, frames, loops, delays, controls, palette };
}
test("LZW dictionary growth and resets preserve independently decoded color pixels", () => {
  for (const count of [255, 256, 257, 511, 512, 1024, 20000]) {
    const rgba = Buffer.alloc(count * 4);
    let seed = 123456789;
    for (let i = 0; i < count; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const color = (seed >>> 0) % 32;
      rgba.set([color * 8, color * 4, color * 2, 255], i * 4);
    }
    const parsed = decode(encodeGIF([rgba], count, 1, [20]));
    assert.equal(parsed.frames[0].length, count);
    for (let i = 0; i < count; i++)
      assert.deepEqual(parsed.palette[parsed.frames[0][i]], [...rgba.subarray(i * 4, i * 4 + 3)]);
  }
});
test("six visual states plus legacy aliases are deterministic, transparent animated GIFs with original SVG previews", () => {
  assert.deepEqual(visualStates, ["idle", "thinking", "writing", "patching", "error", "done"]);
  for (const state of Object.keys(states)) {
    const data = gif(state),
      parsed = decode(data);
    assert.equal(parsed.width, 192);
    assert.equal(parsed.height, 208);
    assert.equal(parsed.frames.length, states[state].animation.length);
    assert.deepEqual(parsed.delays, states[state].animation.map((frame) => frame.delay));
    assert.equal(parsed.delays.reduce((n, d) => n + d, 0), states[state].delays.reduce((n, d) => n + d, 0));
    assert.ok(parsed.loops);
    assert.ok(data.length <= 1000000, `${state} GIF stays below 1 MB`);
    assert.ok(parsed.delays.every((delay) => delay >= 8 && delay <= 12));
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

test("full-body motion preserves every translated original mascot pixel without cropping or recoloring", async () => {
  const { motionOffset, moveSprite } = await import("../src/assets/pixel-effects.js");
  for (const [state, spec] of Object.entries(states)) {
    if (state === "writing" || state === "working") continue; // Articulated paws have their own invariant below.
    let additions = 0;
    const variations = new Set(), offsets = new Set();
    for (let i = 0; i < spec.animation.length; i++) {
      const elapsed = i * 100, base = sprite(state, spec.animation[i].sourceFrame), frame = animatedSprite(state, i);
      const moved = moveSprite(base, state, elapsed), { dx, dy } = motionOffset(base, state, elapsed);
      variations.add(frame.toString("base64"));
      offsets.add(`${dx}:${dy}`);
      let sourcePixels = 0, movedPixels = 0;
      for (let y = 0; y < 208; y++) for (let x = 0; x < 192; x++) {
        const p = (y * 192 + x) * 4;
        if (base[p + 3]) {
          sourcePixels++;
          assert.ok(x + dx >= 0 && x + dx < 192 && y + dy >= 0 && y + dy < 208);
          const to = ((y + dy) * 192 + x + dx) * 4;
          assert.deepEqual(frame.subarray(to, to + 4), base.subarray(p, p + 4));
        }
        if (moved[p + 3]) movedPixels++;
        else if (frame[p + 3]) { assert.equal(frame[p + 3], 255); additions++; }
      }
      assert.equal(movedPixels, sourcePixels, `${state} source pixels never crop`);
    }
    assert.ok(additions > 0, `${state} has distinct FX`);
    assert.ok(offsets.size > 1, `${state} moves the whole body`);
    assert.ok(variations.size >= spec.animation.length / 2, state);
    const parsed = decode(gif(state));
    assert.ok(parsed.controls.every((c) => c.transparent && c.disposal === 2 && c.transparentIndex === 0));
    assert.ok(parsed.frames.every((f) => f[0] === 0));
  }
});

test("optional animated badges are transparent 96px GIFs on an exact 4x pixel grid", async () => {
  const { badgeSpecs, badgeDelays, statusAnimationPixels, statusAnimationFrame } = await import("../src/assets/status-icons.js");
  for (const kind of Object.keys(badgeSpecs)) {
    const gifBytes = statusGIF(kind), parsed = decode(gifBytes);
    assert.equal(parsed.width, 96);
    assert.equal(parsed.height, 96);
    assert.equal(parsed.frames.length, badgeDelays.length);
    assert.deepEqual(parsed.delays, badgeDelays);
    assert.ok(parsed.loops);
    assert.ok(parsed.controls.every((c) => c.transparent && c.disposal === 2));
    assert.ok(new Set(parsed.frames.map((f) => f.toString("base64"))).size > 1, kind);
    assert.deepEqual(gifBytes, fs.readFileSync(new URL(`../assets/pet/codex-status-${kind}.gif`, import.meta.url)));
    for (let frame = 0; frame < badgeDelays.length; frame++) {
      const small = statusAnimationPixels(kind, frame), full = statusAnimationFrame(kind, frame);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const src = (Math.floor(y / 4) * 24 + Math.floor(x / 4)) * 4, dst = (y * 96 + x) * 4;
        assert.deepEqual(full.subarray(dst, dst + 4), small.subarray(src, src + 4));
        assert.ok(full[dst + 3] === 0 || full[dst + 3] === 255);
        assert.equal(parsed.frames[frame][y * 96 + x] === 0, full[dst + 3] === 0);
      }
    }
  }
  const manifest = JSON.parse(fs.readFileSync(new URL("../assets/pet/manifest.json", import.meta.url)));
  assert.equal(manifest.effects.version, "pixel-fx-3");
  assert.match(manifest.effects.policy, /alpha zero/);
  assert.ok(fs.existsSync(new URL("../assets/pet/animation-gallery.html", import.meta.url)));
  const gallery = fs.readFileSync(new URL("../assets/pet/animation-gallery.html", import.meta.url), "utf8");
  assert.ok(!gallery.includes("<style>"));
  assert.match(gallery, /href="animation-gallery\.css"/);
  assert.ok(fs.existsSync(new URL("../assets/pet/animation-gallery.css", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../assets/pet/animation-spritesheet.png", import.meta.url)));
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
    ["working", 7, 1],
    ["writing", 7, 1],
    ["patching", 4, 4],
    ["error", 5, 1],
    ["done", 8, 3],
    ["thinking", 6, 4],
    ["waiting", 3, 4],
    ["idle", 0, 1],
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

test("high-movement loops maintain one expression family per state and legacy compatibility", () => {
  assert.deepEqual(states.writing.sourceFrames, [0]);
  assert.deepEqual(states.thinking.sourceFrames, [0, 3, 4, 3]);
  assert.deepEqual(states.error.sourceFrames, [1]);
  assert.deepEqual(states.done.sourceFrames, [1, 2, 1]);
  assert.deepEqual(states.idle.sourceFrames, [1]);
  assert.deepEqual(gif("working"), gif("writing"));
  assert.notDeepEqual(gif("waiting"), gif("done"));
  for (const spec of Object.values(states)) {
    assert.equal(spec.animation.length, spec.delays.length);
    assert.equal(spec.fps, 10);
    assert.ok(spec.animation.length >= 30);
    assert.ok(spec.delays.every((d) => d === 10));
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

// The user-visible requirement: typing moves both paws, not the seated mascot.
test("writing alternates both hands while the face, body and laptop stay fixed", async () => {
  const { motionOffset } = await import("../src/assets/pixel-effects.js");
  for (const state of ["writing", "working"]) {
    const base = sprite(state, 0), left = new Set(), right = new Set();
    for (let n = 0; n < states[state].frameCount; n++) {
      const frame = animatedSprite(state, n);
      assert.deepEqual(motionOffset(base, state, n * 100), {dx: 0, dy: 0});
      const hands = [[], []];
      let changed = 0;
      for (let y = 0; y < 208; y++) {
        const row = y * 192 * 4;
        if (y < 144 || y > 172) assert.ok(frame.subarray(row, row + 192 * 4).equals(base.subarray(row, row + 192 * 4)));
        else {
          assert.ok(frame.subarray(row, row + 67 * 4).equals(base.subarray(row, row + 67 * 4)));
          assert.ok(frame.subarray(row + 104 * 4, row + 192 * 4).equals(base.subarray(row + 104 * 4, row + 192 * 4)));
          for (let x = 67; x <= 103; x++) {
            const i = row + x * 4;
            if (!frame.subarray(i, i + 4).equals(base.subarray(i, i + 4))) changed++;
            hands[x < 84 ? 0 : 1].push(...frame.subarray(i, i + 4));
          }
        }
      }
      assert.ok(changed > 20, "hands visibly change, not just a blinking key");
      left.add(Buffer.from(hands[0]).toString("base64")); right.add(Buffer.from(hands[1]).toString("base64"));
    }
    assert.ok(left.size >= 3, "near paw presses and releases");
    assert.ok(right.size >= 3, "far paw presses and releases");
    const parsed = decode(gif(state));
    assert.equal(parsed.frames.length, states[state].frameCount);
    assert.ok(parsed.controls.every(c => c.transparent && c.disposal === 2));
    for (const decoded of parsed.frames) for (let y = 0; y < 208; y++) {
      const row = y * 192, reference = parsed.frames[0];
      if (y < 144 || y > 172) assert.ok(decoded.subarray(row, row + 192).equals(reference.subarray(row, row + 192)), "encoded body must not jitter");
      else {
        assert.ok(decoded.subarray(row, row + 67).equals(reference.subarray(row, row + 67)));
        assert.ok(decoded.subarray(row + 104, row + 192).equals(reference.subarray(row + 104, row + 192)));
      }
    }
  }
});

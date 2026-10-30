import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gif, svg, pixels } from "../src/assets/generate-pet-gifs.js";
// Independent GIF container + LZW reader validates decoded pixel counts and
// frame differences, rather than merely looking for a GIF header.
function decode(data) {
  let pos = 6;
  const width = data.readUInt16LE(pos),
    height = data.readUInt16LE(pos + 2),
    packed = data[pos + 4];
  pos += 7;
  if (packed & 128) pos += 3 * 2 ** ((packed & 7) + 1);
  const frames = [];
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
  }
  return { width, height, frames, loops };
}
test("four deterministic GIF89a files contain eight decoded looping animation frames; SVG previews exist", () => {
  for (const state of ["working", "thinking", "waiting", "idle"]) {
    const data = gif(state),
      parsed = decode(data);
    assert.equal(parsed.width, 192);
    assert.equal(parsed.height, 192);
    assert.equal(parsed.frames.length, 8);
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

// Tiny PNG RGBA8 codec for deterministic sprite extraction. No drawing or
// reconstruction of the source artwork takes place here.
import { inflateSync } from "node:zlib";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
// Fixed-Huffman DEFLATE with a deterministic single-candidate LZ77 matcher.
// Avoids platform zlib encoder differences while retaining compact PNG assets.
function deterministicZlib(data) {
  const bytes = [];
  let buffer = 0,
    count = 0;
  const bits = (value, length) => {
    buffer |= value << count;
    count += length;
    while (count >= 8) {
      bytes.push(buffer & 255);
      buffer >>>= 8;
      count -= 8;
    }
  };
  const reverse = (value, length) => {
    let out = 0;
    for (let i = 0; i < length; i++) {
      out = (out << 1) | (value & 1);
      value >>>= 1;
    }
    return out;
  };
  const literal = (value) => {
    const length = value < 144 ? 8 : value < 256 ? 9 : value < 280 ? 7 : 8;
    const code =
      value < 144
        ? 0x30 + value
        : value < 256
          ? 0x190 + value - 144
          : value < 280
            ? value - 256
            : 0xc0 + value - 280;
    bits(reverse(code, length), length);
  };
  const lengths = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
    83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const lengthBits = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
  ];
  const distances = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
    769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const distanceBits = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13,
  ];
  bits(3, 3);
  const positions = new Map();
  let position = 0;
  while (position < data.length) {
    let length = 0,
      distance = 0;
    if (position + 4 <= data.length) {
      const key = data.readUInt32LE(position),
        previous = positions.get(key);
      if (previous !== undefined && position - previous <= 32768) {
        while (
          length < 258 &&
          position + length < data.length &&
          data[previous + length] === data[position + length]
        )
          length++;
        distance = position - previous;
      }
    }
    const consumed = length >= 4 ? length : 1;
    if (length >= 4) {
      let i = lengths.length - 1;
      while (lengths[i] > length) i--;
      literal(257 + i);
      bits(length - lengths[i], lengthBits[i]);
      let d = distances.length - 1;
      while (distances[d] > distance) d--;
      bits(reverse(d, 5), 5);
      bits(distance - distances[d], distanceBits[d]);
    } else literal(data[position]);
    for (let i = 0; i < consumed && position + i + 4 <= data.length; i++)
      positions.set(data.readUInt32LE(position + i), position + i);
    position += consumed;
  }
  literal(256);
  if (count) bytes.push(buffer & 255);
  let a = 1,
    b = 0;
  for (const value of data) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(((b << 16) | a) >>> 0);
  return Buffer.concat([
    Buffer.from([0x78, 0x01]),
    Buffer.from(bytes),
    checksum,
  ]);
}
export function encodePNG(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4,
    scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++)
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(
      scanlines,
      y * (stride + 1) + 1,
    );
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deterministicZlib(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function decodePNG(buffer, { maxDimension = 4096, maxPixels = 16_777_216 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 8).equals(signature))
    throw Error("Invalid PNG signature");
  let pos = 8, width, height, depth, color, palette, alpha, ended = false;
  const idat = [];
  while (pos < buffer.length) {
    if (pos + 12 > buffer.length) throw Error("Truncated PNG chunk");
    const length = buffer.readUInt32BE(pos),
      type = buffer.toString("ascii", pos + 4, pos + 8),
      data = buffer.subarray(pos + 8, pos + 8 + length);
    if (length > buffer.length - pos - 12) throw Error("Truncated PNG chunk");
    if (crc32(buffer.subarray(pos + 4, pos + 8 + length)) !== buffer.readUInt32BE(pos + 8 + length)) throw Error("Invalid PNG checksum");
    if (!width && type !== "IHDR") throw Error("PNG must start with IHDR");
    if (type === "IHDR") {
      if (width || length !== 13) throw Error("Invalid PNG header");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
      if (!width || !height || width > maxDimension || height > maxDimension || width * height > maxPixels) throw Error("PNG dimensions exceed the image limit");
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || data[10] || data[11] || data[12]) throw Error("Use a non-interlaced PNG in RGB, RGBA, grayscale or indexed color");
    }
    if (type === "PLTE") { if (!length || length > 768 || length % 3) throw Error("Invalid PNG palette"); palette = data; }
    if (type === "tRNS") alpha = data;
    if (type === "IDAT") idat.push(data);
    pos += length + 12;
    if (type === "IEND") { if (length) throw Error("Invalid PNG end chunk"); ended = true; break; }
  }
  if (!ended || !idat.length || (color === 3 && !palette)) throw Error("Incomplete PNG image");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const stride = Math.ceil(width * channels * depth / 8), bpp = Math.max(1, Math.ceil(channels * depth / 8));
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  const filtered = Buffer.alloc(stride * height);
  if (raw.length !== (stride + 1) * height)
    throw Error("Invalid PNG scanline length");
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error("Unknown PNG filter");
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? filtered[y * stride + x - bpp] : 0,
        b = y ? filtered[(y - 1) * stride + x] : 0,
        c = y && x >= bpp ? filtered[(y - 1) * stride + x - bpp] : 0;
      filtered[y * stride + x] =
        (raw[y * (stride + 1) + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  if (color === 6 && depth === 8) return { width, height, rgba: filtered };
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const sample = (channel) => {
      if (depth >= 8) return depth === 16 ? filtered.readUInt16BE(y * stride + (x * channels + channel) * 2) : filtered[y * stride + x * channels + channel];
      const bit = x * depth;
      return (filtered[y * stride + (bit >> 3)] >> (8 - depth - bit % 8)) & ((1 << depth) - 1);
    };
    const scale = (value) => Math.round(value * 255 / ((2 ** depth) - 1));
    if (color === 3) {
      const index = sample(0);
      if (index * 3 + 2 >= palette.length) throw Error("Invalid PNG palette index");
      rgba[offset] = palette[index * 3]; rgba[offset + 1] = palette[index * 3 + 1]; rgba[offset + 2] = palette[index * 3 + 2]; rgba[offset + 3] = alpha?.[index] ?? 255;
    } else if (color === 0 || color === 4) {
      const gray = sample(0); rgba.fill(scale(gray), offset, offset + 3);
      rgba[offset + 3] = color === 4 ? scale(sample(1)) : alpha?.length === 2 && alpha.readUInt16BE(0) === gray ? 0 : 255;
    } else {
      const rgb = [sample(0), sample(1), sample(2)];
      for (let channel = 0; channel < 3; channel++) rgba[offset + channel] = scale(rgb[channel]);
      rgba[offset + 3] = color === 6 ? scale(sample(3)) : alpha?.length === 6 && rgb.every((value, channel) => value === alpha.readUInt16BE(channel * 2)) ? 0 : 255;
    }
  }
  return { width, height, rgba };
}

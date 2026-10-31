// Bounded GIF87a/89a reader. Frames are composited before sampling or resizing;
// user artwork never needs an external decoder or a runtime image dependency.
const defaults = { maxBytes: 20 * 1024 * 1024, maxDimension: 2048, maxFrames: 600, maxSourcePixels: 100_000_000, maxOutputPixels: 32_000_000 };
const invalid = (message) => new Error(`Invalid GIF: ${message}`);
function parse(bytes, options) {
  const limits = { ...defaults, ...options }, data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (data.length < 14 || data.length > limits.maxBytes || !['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) throw invalid('unsupported header or file size');
  const width = data.readUInt16LE(6), height = data.readUInt16LE(8);
  if (!width || !height || width > limits.maxDimension || height > limits.maxDimension) throw invalid('canvas dimensions exceed the limit');
  let position = 13, sourcePixels = 0, ended = false;
  const take = (length) => { if (position + length > data.length) throw invalid('truncated data'); const value = data.subarray(position, position + length); position += length; return value; };
  const palette = (flags) => take(3 * 2 ** ((flags & 7) + 1));
  const global = data[10] & 128 ? palette(data[10]) : null, backgroundIndex = data[11];
  const blocks = () => {
    const parts = []; let total = 0;
    for (;;) { const size = take(1)[0]; if (!size) break; total += size; if (total > limits.maxBytes) throw invalid('extension or image data too large'); parts.push(take(size)); }
    return parts;
  };
  const frames = []; let control = { delay: 0, disposal: 0, transparent: false, transparentIndex: 0 };
  while (position < data.length) {
    const kind = take(1)[0];
    if (kind === 0x3b) { ended = true; break; }
    if (kind === 0x21) {
      const label = take(1)[0], parts = blocks();
      if (label === 0xf9) {
        if (parts.length !== 1 || parts[0].length !== 4) throw invalid('malformed graphics control');
        const b = parts[0], disposal = (b[0] >>> 2) & 7;
        if (disposal > 3) throw invalid('unsupported disposal method');
        control = { delay: b.readUInt16LE(1), disposal, transparent: !!(b[0] & 1), transparentIndex: b[3] };
      } else if (label === 0x01) throw invalid('plain-text rendering is unsupported');
      continue;
    }
    if (kind !== 0x2c) throw invalid('unexpected block');
    const descriptor = take(9), left = descriptor.readUInt16LE(0), top = descriptor.readUInt16LE(2), w = descriptor.readUInt16LE(4), h = descriptor.readUInt16LE(6), flags = descriptor[8];
    if (!w || !h || left + w > width || top + h > height) throw invalid('frame lies outside its canvas');
    sourcePixels += width * height;
    if (sourcePixels > limits.maxSourcePixels || frames.length >= limits.maxFrames) throw invalid('animation decoding budget exceeded');
    const colors = flags & 128 ? palette(flags) : global;
    if (!colors) throw invalid('missing color palette');
    const minimum = take(1)[0]; if (minimum < 2 || minimum > 8) throw invalid('invalid LZW code size');
    const parts = blocks();
    frames.push({ left, top, width: w, height: h, interlaced: !!(flags & 64), colors, minimum, parts, ...control });
    control = { delay: 0, disposal: 0, transparent: false, transparentIndex: 0 };
  }
  if (!ended || !frames.length) throw invalid('missing trailer or frames');
  return { width, height, global, backgroundIndex, frames, limits };
}
export function inspectGIF(bytes, options = {}) {
  const image = parse(bytes, options), delays = image.frames.map((frame) => frame.delay);
  return { width: image.width, height: image.height, frameCount: image.frames.length, delays, durationMs: delays.reduce((sum, delay) => sum + Math.max(1, delay) * 10, 0) };
}
function indices(frame) {
  const compressed = Buffer.concat(frame.parts), clear = 1 << frame.minimum, end = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097), out = Buffer.alloc(frame.width * frame.height);
  let next = clear + 2, codeSize = frame.minimum + 1, previous = -1, first = 0, bit = 0, written = 0, ended = false;
  while (bit + codeSize <= compressed.length * 8) {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) code |= ((compressed[bit >>> 3] >>> (bit & 7)) & 1) << i;
    if (code === clear) { next = clear + 2; codeSize = frame.minimum + 1; previous = -1; continue; }
    if (code === end) { ended = true; break; }
    const original = code; let length = 0;
    if (code === next && previous >= 0) { stack[length++] = first; code = previous; }
    else if (code >= next) throw invalid('invalid LZW dictionary reference');
    while (code >= clear + 2) {
      if (code >= next || length >= 4096) throw invalid('cyclic LZW dictionary');
      stack[length++] = suffix[code]; code = prefix[code];
    }
    if (code >= clear) throw invalid('invalid LZW terminal');
    first = code; stack[length++] = first;
    if (written + length > out.length) throw invalid('too many decoded pixels');
    while (length) out[written++] = stack[--length];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous; suffix[next++] = first;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = original;
  }
  if (!ended || written !== out.length) throw invalid('truncated or incomplete LZW pixels');
  return out;
}
export function resizeRGBA(rgba, fromWidth, fromHeight, toWidth, toHeight) {
  for (const value of [fromWidth, fromHeight, toWidth, toHeight]) if (!Number.isSafeInteger(value) || value < 1 || value > 4096) throw invalid('invalid resize dimensions');
  if (rgba.length !== fromWidth * fromHeight * 4 || toWidth * toHeight > 4_194_304) throw invalid('invalid resize buffer or pixel budget');
  if (fromWidth === toWidth && fromHeight === toHeight) return Buffer.from(rgba);
  const out = Buffer.alloc(toWidth * toHeight * 4);
  for (let y = 0; y < toHeight; y++) {
    const sy = Math.max(0, Math.min(fromHeight - 1, (y + 0.5) * fromHeight / toHeight - 0.5)), y0 = Math.floor(sy), y1 = Math.min(fromHeight - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < toWidth; x++) {
      const sx = Math.max(0, Math.min(fromWidth - 1, (x + 0.5) * fromWidth / toWidth - 0.5)), x0 = Math.floor(sx), x1 = Math.min(fromWidth - 1, x0 + 1), fx = sx - x0;
      const points = [[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]];
      let alpha = 0, r = 0, g = 0, b = 0;
      for (const [px,py,weight] of points) { const i = (py * fromWidth + px) * 4, a = rgba[i+3] * weight; alpha += a; r += rgba[i] * a; g += rgba[i+1] * a; b += rgba[i+2] * a; }
      const at = (y * toWidth + x) * 4;
      if (alpha) { out[at] = Math.round(r/alpha); out[at+1] = Math.round(g/alpha); out[at+2] = Math.round(b/alpha); out[at+3] = Math.round(alpha); }
    }
  }
  return out;
}
export function decodeGIF(bytes, options = {}) {
  const image = parse(bytes, options), sourceWidth = image.width, sourceHeight = image.height;
  const width = options.outputWidth ?? sourceWidth, height = options.outputHeight ?? sourceHeight;
  if (![width,height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= image.limits.maxDimension)) throw invalid('invalid output dimensions');
  const delaysIn = image.frames.map((f) => Math.max(1,f.delay)), total = delaysIn.reduce((sum,n) => sum+n,0);
  const step = options.sampleMs === undefined ? null : Math.max(1, Math.round(options.sampleMs / 10));
  if (step !== null && (!Number.isFinite(options.sampleMs) || options.sampleMs <= 0 || step > 65535)) throw invalid('invalid sampling interval');
  const count = step ? Math.ceil(total / step) : image.frames.length;
  if (count * width * height > image.limits.maxOutputPixels) throw invalid('output animation pixel budget exceeded');
  const canvas = Buffer.alloc(sourceWidth * sourceHeight * 4), frames = [], delays = [];
  const background = (frame) => image.global && !(frame.transparent && frame.transparentIndex === image.backgroundIndex) && image.backgroundIndex * 3 + 2 < image.global.length
    ? [...image.global.subarray(image.backgroundIndex*3,image.backgroundIndex*3+3),255] : [0,0,0,0];
  const fill = (frame) => { const color = background(frame), row = Buffer.alloc(frame.width * 4); for(let x=0;x<frame.width;x++) row.set(color,x*4); for(let y=frame.top;y<frame.top+frame.height;y++) row.copy(canvas,(y*sourceWidth+frame.left)*4); };
  fill({ ...image.frames[0], left:0,top:0,width:sourceWidth,height:sourceHeight });
  let prior, saved, elapsed = 0, sampleAt = 0;
  for (let n=0;n<image.frames.length;n++) {
    const frame = image.frames[n];
    if (prior?.disposal === 2) fill(prior);
    else if (prior?.disposal === 3 && saved) saved.copy(canvas);
    saved = frame.disposal === 3 ? Buffer.from(canvas) : null;
    const decoded = indices(frame); let rowOrder;
    if (frame.interlaced) { rowOrder=[];for(const [start,increment]of [[0,8],[4,8],[2,4],[1,2]])for(let y=start;y<frame.height;y+=increment)rowOrder.push(y); }
    for(let row=0;row<frame.height;row++)for(let x=0;x<frame.width;x++) {
      const index=decoded[row*frame.width+x];if(frame.transparent&&index===frame.transparentIndex)continue;
      if(index*3+2>=frame.colors.length)throw invalid('pixel references a missing color');
      const at=((frame.top+(rowOrder?rowOrder[row]:row))*sourceWidth+frame.left+x)*4;
      canvas[at]=frame.colors[index*3];canvas[at+1]=frame.colors[index*3+1];canvas[at+2]=frame.colors[index*3+2];canvas[at+3]=255;
    }
    const endAt = elapsed + delaysIn[n];
    if (step) {
      let resized;
      while(sampleAt<endAt&&sampleAt<total) { resized ||= resizeRGBA(canvas,sourceWidth,sourceHeight,width,height);frames.push(Buffer.from(resized));delays.push(Math.min(step,total-sampleAt));sampleAt+=step; }
    } else { frames.push(resizeRGBA(canvas,sourceWidth,sourceHeight,width,height));delays.push(delaysIn[n]); }
    elapsed=endAt;prior=frame;
  }
  return { width,height,sourceWidth,sourceHeight,frames,delays,durationMs:total*10 };
}

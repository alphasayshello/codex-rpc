// Maintainer-only media preparation. Original supplied GIFs stay outside the
// repository; outputs retain their complete timeline and existing artwork.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectGIF, decodeGIF, resizeRGBA } from '../src/assets/gif.js';
import { encodeGIF } from '../src/assets/generate-pet-gifs.js';
import { decodePNG, encodePNG } from '../src/assets/png.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
if (!input) throw Error('Usage: node scripts/prepare-base-pet.js <supplied-assets-directory>');
const output = path.join(root, 'assets/pets/codex-bloom');
fs.mkdirSync(output, { recursive: true });
const names = ['coding','thinking','reading','searching','debugging','building','deploying','success','error','sleeping'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sources = {}, animations = {};
for (const name of names) {
  const bytes = fs.readFileSync(path.join(input,name+'.gif')), original = inspectGIF(bytes);
  let decoded, encoded, size;
  for (size of [160,144,128,112]) {
    decoded = decodeGIF(bytes, { outputWidth:size, outputHeight:size, sampleMs:100 });
    encoded = encodeGIF(decoded.frames,size,size,decoded.delays);
    if (encoded.length < 1_000_000) break;
  }
  if (encoded.length >= 1_000_000) throw Error(`${name}: cannot satisfy the bundled GIF size budget`);
  fs.writeFileSync(path.join(output,name+'.gif'),encoded);
  const preview = encodePNG(size,size,decoded.frames[0]);
  fs.writeFileSync(path.join(output,name+'.png'),preview);
  sources[name] = { filename:name+'.gif', bytes:bytes.length, sha256:sha(bytes), width:original.width, height:original.height, frames:original.frameCount, durationMs:original.durationMs };
  animations[name] = { gif:name+'.gif', preview:name+'.png', width:size,height:size,frames:decoded.frames.length,durationMs:decoded.durationMs,fps:10,bytes:encoded.length,sha256:sha(encoded),previewSHA256:sha(preview) };
  console.log(`${name}: ${original.frameCount} source frames → ${decoded.frames.length} frames, ${size}px, ${encoded.length} bytes`);
}
const iconBytes=fs.readFileSync(path.join(input,'codex.png')),icon=decodePNG(iconBytes);
fs.writeFileSync(path.join(output,'preview.png'),encodePNG(160,160,resizeRGBA(icon.rgba,icon.width,icon.height,160,160)));
sources.icon={filename:'codex.png',bytes:iconBytes.length,sha256:sha(iconBytes)};
const manifest={schemaVersion:1,id:'codex-bloom',name:'Codex Bloom',description:'The supplied purple Codex flower mascot, with its original typing arms and illustrated scenes.',provenance:{kind:'user-supplied',source:'Supplied assets folder from the project owner; no upstream license or creator attribution was included.',processing:'Original GIF compositing and backgrounds preserved; bilinear resize, timeline sampling at100ms, palette quantization, GIF89a re-encoding. No AI redraw or background removal.',sources},animations};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGIF } from '../src/assets/generate-pet-gifs.js';
import { inspectGIF, decodeGIF, resizeRGBA } from '../src/assets/gif.js';
const color = { black:[0,0,0,255], red:[255,0,0,255], green:[0,255,0,255], blue:[0,0,255,255] };
const u16 = n => Buffer.from([n & 255,n >>> 8]);
function fixture(width,height,frames) {
  const chunks=[Buffer.from('GIF89a'),u16(width),u16(height),Buffer.from([0x81,0,0]),Buffer.from([0,0,0,255,0,0,0,255,0,0,0,255])];
  for(const frame of frames){
    const {left=0,top=0,w=width,h=height,disposal=1,transparent=false,delay=7,indices,interlaced=false,local}=frame;
    chunks.push(Buffer.from([0x21,0xf9,4,(disposal<<2)|(transparent?1:0)]),u16(delay),Buffer.from([0,0,0x2c]),u16(left),u16(top),u16(w),u16(h),Buffer.from([(interlaced?64:0)|(local?0x81:0)]));
    if(local)chunks.push(Buffer.from(local));
    const codes=indices.flatMap(index=>[4,index]);codes.push(5);
    const bytes=Buffer.alloc(Math.ceil(codes.length*3/8));let bit=0;
    for(const code of codes)for(let j=0;j<3;j++,bit++)bytes[bit>>>3]|=((code>>>j)&1)<<(bit&7);
    chunks.push(Buffer.from([2,bytes.length]),bytes,Buffer.from([0]));
  }
  chunks.push(Buffer.from([0x3b]));return Buffer.concat(chunks);
}
const pixels = colors => Buffer.from(colors.flatMap(name=>color[name]));

test('GIF decoder follows LZW dictionary growth, resets and exact RGBA color pixels',()=>{
  const width=200,height=100,rgba=Buffer.alloc(width*height*4);let seed=123456789;
  for(let i=0;i<width*height;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const c=(seed>>>0)%32;rgba.set([c*8,c*8,c*8,255],i*4);}
  const bytes=encodeGIF([rgba],width,height,[17]),meta=inspectGIF(bytes),decoded=decodeGIF(bytes);
  assert.equal(meta.frameCount,1);assert.equal(meta.durationMs,170);assert.deepEqual(decoded.frames[0],rgba);assert.deepEqual(decoded.delays,[17]);
});

test('disposal 2 restores the logical background and disposal 3 restores the previous canvas',()=>{
  for(const [disposal,expected]of [[2,['black','blue']],[3,['red','blue']]]){
    const bytes=fixture(2,1,[{indices:[1,1]},{indices:[2],w:1,disposal},{indices:[3],left:1,w:1}]);
    const decoded=decodeGIF(bytes);
    assert.deepEqual(decoded.frames[0],pixels(['red','red']));assert.deepEqual(decoded.frames[1],pixels(['green','red']));assert.deepEqual(decoded.frames[2],pixels(expected));
  }
});

test('transparent pixels preserve previous artwork, local palettes and interlaced rows decode correctly',()=>{
  const transparent=decodeGIF(fixture(2,1,[{indices:[1,1],transparent:true},{indices:[0,2],transparent:true}]));
  assert.deepEqual(transparent.frames[1],pixels(['red','green']));
  const local=decodeGIF(fixture(2,1,[{indices:[1,1],local:[0,0,0,0,255,0,255,0,0,0,0,255]}]));
  assert.deepEqual(local.frames[0],pixels(['green','green']));
  const interlace=decodeGIF(fixture(1,4,[{indices:[1,3,2,1],interlaced:true}]));
  assert.deepEqual(interlace.frames[0],pixels(['red','green','blue','red']));
});

test('timeline sampling chooses source composites and retains the exact animation duration',()=>{
  const bytes=fixture(1,1,[{indices:[1]},{indices:[2]},{indices:[3]}]);
  const decoded=decodeGIF(bytes,{sampleMs:100,outputWidth:2,outputHeight:2});
  assert.deepEqual(decoded.delays,[10,10,1]);assert.equal(decoded.durationMs,210);assert.equal(decoded.frames.length,3);
  assert.deepEqual(decoded.frames[0],pixels(['red','red','red','red']));assert.deepEqual(decoded.frames[1],pixels(['green','green','green','green']));assert.deepEqual(decoded.frames[2],pixels(['blue','blue','blue','blue']));
});

test('GIF parser rejects truncated images, invalid references, out-of-canvas rectangles and resource excess',()=>{
  const good=fixture(2,1,[{indices:[1,1]},{indices:[2,2]}]);
  assert.throws(()=>decodeGIF(good.subarray(0,-1)),/Invalid GIF/);
  assert.throws(()=>inspectGIF(good,{maxFrames:1}),/budget/);
  assert.throws(()=>inspectGIF(good,{maxDimension:1}),/dimensions/);
  assert.throws(()=>inspectGIF(good,{maxBytes:10}),/size/);
  assert.throws(()=>inspectGIF(good,{maxSourcePixels:3}),/budget/);
  assert.throws(()=>decodeGIF(good,{maxOutputPixels:1}),/budget/);
  assert.throws(()=>decodeGIF(good,{sampleMs:NaN}),/sampling/);
  assert.throws(()=>decodeGIF(good,{sampleMs:1e20}),/sampling/);
  const overflow=fixture(2,1,[{indices:[1,1],left:1}]);assert.throws(()=>inspectGIF(overflow),/outside/);
  const badHeader=Buffer.from(good);badHeader.write('NOTGIF',0);assert.throws(()=>inspectGIF(badHeader),/header/);
  const broken=fixture(1,1,[{indices:[3]}]); const start=broken.indexOf(Buffer.from([0x2c]));broken[start+11]=0xff;assert.throws(()=>decodeGIF(broken),/Invalid GIF/);
});

test('RGBA resize uses alpha-aware interpolation without dark transparent edge halos',()=>{
  const source=Buffer.from([255,0,0,255,0,0,0,0]);
  const down=resizeRGBA(source,2,1,1,1);assert.deepEqual([...down],[255,0,0,128]);
  assert.deepEqual(resizeRGBA(source,2,1,2,1),source);
  assert.throws(()=>resizeRGBA(source,2,2,1,1),/buffer/);
  assert.throws(()=>resizeRGBA(source,2,1,10000,1),/dimensions/);
});

test('bundled Codex Bloom media matches provenance hashes and preserves every source timeline', async()=>{
  const {default:fs}=await import('node:fs');const {createHash}=await import('node:crypto');
  const base=new URL('../assets/pets/codex-bloom/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',base),'utf8'));
  assert.equal(manifest.id,'codex-bloom');assert.equal(Object.keys(manifest.animations).length,10);
  assert.ok(!JSON.stringify(manifest).includes('/Users/'));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [name,entry]of Object.entries(manifest.animations)){
    const bytes=fs.readFileSync(new URL(entry.gif,base)),preview=fs.readFileSync(new URL(entry.preview,base));
    assert.equal(hash(bytes),entry.sha256,name);assert.equal(hash(preview),entry.previewSHA256,name);assert.equal(bytes.length,entry.bytes,name);assert.ok(bytes.length<1_000_000,name);
    const decoded=decodeGIF(bytes);assert.equal(decoded.width,entry.width,name);assert.equal(decoded.height,entry.height,name);assert.equal(decoded.frames.length,entry.frames,name);assert.equal(decoded.durationMs,manifest.provenance.sources[name].durationMs,name);assert.equal(decoded.durationMs,entry.durationMs,name);
    assert.ok(decoded.delays.every(n=>n===10),name);assert.ok(new Set(decoded.frames.map(frame=>hash(frame))).size>1,name);
  }
});

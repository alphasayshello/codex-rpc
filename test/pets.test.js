import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { sandbox } from "./helpers.js";
import { encodePNG, decodePNG } from "../src/assets/png.js";
import { encodeGIF } from "../src/assets/generate-pet-gifs.js";
import { inspectGIF } from "../src/assets/gif.js";
import { getPet, listPets, importPet, selectPet, resolvePetAsset, readPetAsset, exportPet, downloadPet } from "../src/pets.js";
import { config } from "../src/store.js";
import { serve } from "../src/server.js";

function sheet() {
  const width = 256, height = 224, rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 7; row++) for (let column = 0; column < 8; column++)
    for (let y = 8; y < 26; y++) for (let x = 8; x < 24; x++) {
      const at = ((row * 32 + y) * width + column * 32 + x) * 4;
      rgba.set([30 + row * 25, 70 + column * 15, 170, 255], at);
    }
  return encodePNG(width, height, rgba).toString("base64");
}
function smallGIF() {
  const a = Buffer.alloc(4 * 4 * 4), b = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 4) { a.set([220, 30, 60, 255], i); b.set([30, 70, 220, 255], i); }
  return encodeGIF([a, b], 4, 4, [10, 20]);
}
function pack() {
  const data = smallGIF().toString("base64");
  return { name: "Friendly pet", format: "gif-pack", files: ["sleeping", "thinking", "coding", "error", "success"].map((name) => ({ name: name + ".gif", data })) };
}

test("built-in pets resolve distinct animation families without reading private local paths", (t) => {
  sandbox(t);
  assert.deepEqual(listPets().map((pet) => pet.id), ["codex", "codex-bloom"]);
  const bloom = getPet("codex-bloom"); assert.equal(Object.keys(bloom.animations).length, 19);
  assert.match(bloom.animations.writing.url, /\/codex-bloom\/coding.gif$/);
  assert.match(bloom.animations.idle.path, /sleeping.gif$/);
  assert.equal(bloom.animations.writing.fps, 10);
  assert.equal(bloom.animations.writing.durationMs, 19000);
  assert.equal(bloom.animations.reading.durationMs, 15000);
  assert.equal(bloom.animations.writing.frameCount, 190);
  assert.equal(bloom.animations.writing.width, 160);
  assert.equal(getPet("codex").animations.writing.fps, 20);
  assert.equal(getPet("codex").animations.writing.durationMs, 3200);
  assert.equal(resolvePetAsset("working", { pet: { id: "codex-bloom" } }).url, bloom.animations.writing.url);
  assert.equal(resolvePetAsset("writing", { pet: { id: "codex" } }), null);
  assert.equal(getPet("../config"), null);
});

test("PNG sprite-sheet import builds seven real animations with extra state aliases and portable exports", async (t) => {
  const { rpc } = sandbox(t);
  const result = await importPet({ name: "My reference pet", format: "sheet-v2", image: sheet() });
  assert.equal(result.pet.name, "My reference pet"); assert.equal(result.pet.builtin, false);
  assert.equal(result.pet.requiresHosting, true); assert.ok(result.warnings.length);
  assert.equal(listPets().length, 3);
  assert.equal(result.pet.animations.writing.url, null);
  assert.equal(result.pet.animations.writing.fps, 10);
  assert.equal(result.pet.animations.writing.durationMs, 800);
  assert.equal(result.pet.animations.writing.width, 192);
  assert.equal(result.pet.animations.writing.height, 192);
  const asset = readPetAsset(result.pet.id, "writing.gif");
  assert.equal(inspectGIF(asset.bytes).frameCount, 8);
  assert.equal(inspectGIF(asset.bytes).width, 192);
  assert.equal(result.pet.animations.terminal.path, result.pet.animations.writing.path);
  const exported = exportPet(result.pet.id); assert.equal(exported.files.length, 7);
  assert.equal(exported.format, "gif-pack"); assert.ok(!JSON.stringify(exported).includes(rpc));
  const copy = await importPet(exported); assert.notEqual(copy.pet.id, result.pet.id);
  assert.equal(copy.pet.name, result.pet.name);
  assert.equal(copy.pet.animations.waiting.path.split("/").pop(), exported.states.waiting);
  const zipped = downloadPet(result.pet.id); assert.equal(zipped.readUInt32LE(0), 0x04034b50);
  assert.ok(zipped.includes(Buffer.from("manifest.json"))); assert.ok(zipped.includes(Buffer.from("writing.gif")));
  assert.throws(() => selectPet({ id: result.pet.id }), /public HTTPS/);
  assert.throws(() => selectPet({ id: result.pet.id, baseUrl: "https://localhost/pets/" }), /public HTTPS/);
  const selected = selectPet({ id: result.pet.id, baseUrl: "https://example.com/pets/mine" });
  assert.equal(config().pet.id, result.pet.id);
  assert.equal(selected.pet.animations.writing.url, "https://example.com/pets/mine/writing.gif");
});

test("GIF packs accept documented aliases, preserve small valid loops and reject invalid imports atomically", async (t) => {
  const { rpc } = sandbox(t);
  const pending = importPet(pack());
  await assert.rejects(importPet(pack()), (error) => error.statusCode === 409);
  const imported = await pending;
  assert.deepEqual(readPetAsset(imported.pet.id, "writing.gif").bytes, smallGIF());
  assert.match(imported.warnings.join(" "), /waiting uses the thinking/);
  for (const input of [
    { ...pack(), files: [{ name: "../writing.gif", data: "AAAA" }] },
    { ...pack(), files: [{ name: "writing.svg", data: "AAAA" }] },
    { ...pack(), files: [{ name: "writing.gif", data: "AAAA" }] },
    { ...pack(), files: [{ name: "writing.gif", data: "not base64" }] },
    { ...pack(), files: [{ name: "writing.gif", data: smallGIF().toString("base64") }] },
    { name: "Wrong sheet", format: "sheet-v2", image: encodePNG(256, 256, Buffer.alloc(256 * 256 * 4)).toString("base64") },
  ]) await assert.rejects(importPet(input), /GIF|base64|Missing|empty|blank/);
  assert.equal(listPets().length, 3);
  assert.ok(!fs.readdirSync(path.join(rpc, "pets")).some((name) => name.startsWith(".pending")));
});

test("pet assets and manifests cannot serve symlink targets or arbitrary local files", { skip: process.platform === "win32" }, async (t) => {
  const { rpc, temp } = sandbox(t); const { pet } = await importPet(pack());
  const secret = path.join(temp, "private.gif"); fs.writeFileSync(secret, "private data");
  const target = path.join(rpc, "pets", pet.id, "writing.gif"); fs.unlinkSync(target); fs.symlinkSync(secret, target);
  assert.equal(readPetAsset(pet.id, "writing.gif"), null);
  assert.equal(readPetAsset(pet.id, "manifest.json"), null);
  assert.equal(readPetAsset(pet.id, "../../private.gif"), null);
  fs.unlinkSync(target); execFileSync("mkfifo", [target]);
  const probe = `import {readPetAsset} from ${JSON.stringify(new URL("../src/pets.js", import.meta.url).href)}; console.log(readPetAsset(${JSON.stringify(pet.id)},'writing.gif') === null);`;
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8", timeout: 5000 }).trim(), "true");
  const manifest = path.join(rpc, "pets", pet.id, "manifest.json"); fs.unlinkSync(manifest); fs.symlinkSync(secret, manifest);
  assert.equal(getPet(pet.id), null);
});

test("pet HTTP routes import, select and export safely with origin/token defenses", async (t) => {
  sandbox(t); const server = await serve(0); t.after(() => server.closeDashboard());
  const root = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(root + "/api/session")).json();
  const post = (route, body, extra = {}) => fetch(root + route, { method: "POST", headers: { "Content-Type": "application/json", "x-codex-rpc-token": session.token, ...extra }, body: JSON.stringify(body) });
  assert.equal((await (await fetch(root + "/api/pets")).json()).selected, "codex");
  assert.equal((await post("/api/pets/import", pack(), { "x-codex-rpc-token": "wrong" })).status, 403);
  assert.equal((await post("/api/pets/import", pack(), { Origin: "https://example.com" })).status, 403);
  const uploaded = await post("/api/pets/import", pack()); assert.equal(uploaded.status, 200);
  const { pet } = await uploaded.json();
  assert.equal((await fetch(root + pet.animations.writing.path)).headers.get("Content-Type"), "image/gif");
  assert.equal((await fetch(root + pet.animations.writing.previewPath)).headers.get("Content-Type"), "image/png");
  assert.equal((await post("/api/pets/select", { id: pet.id })).status, 400);
  assert.equal((await post("/api/pets/select", { id: pet.id, baseUrl: "https://example.com/pet/" })).status, 200);
  assert.equal((await post("/api/pets/select", { id: "missing" })).status, 400);
  const exported = await fetch(root + `/api/pets/${pet.id}/export`); assert.match(exported.headers.get("Content-Disposition"), /\.pet\.json/);
  assert.equal((await exported.json()).files.length, 5);
  const download = await fetch(root + `/api/pets/${pet.id}/download`); assert.equal(download.headers.get("Content-Type"), "application/zip");
  assert.equal((await fetch(root + "/api/pets/missing/export")).status, 404);
  assert.equal((await fetch(root + `/pets/${pet.id}/manifest.json`)).status, 404);
  assert.equal((await fetch(root + "/assets/pets/codex-bloom/manifest.json")).status, 404);
  assert.equal((await post("/api/config", { junk: "x".repeat(65536) })).status, 413);
  const original = config().assets.writing; await post("/api/pets/select", { id: "codex-bloom" });
  assert.equal(config().assets.writing, original);
});

test("HTTP import reserves its slot before buffering and releases it after malformed JSON", async (t) => {
  sandbox(t); const server = await serve(0); t.after(() => server.closeDashboard());
  const port = server.address().port, root = `http://127.0.0.1:${port}`;
  const { token } = await (await fetch(root + "/api/session")).json();
  const started = new Promise((resolve) => server.once("request", resolve));
  const slow = http.request({ hostname: "127.0.0.1", port, path: "/api/pets/import", method: "POST", headers: { "x-codex-rpc-token": token, "Content-Type": "application/json" } });
  t.after(() => slow.destroy()); slow.flushHeaders(); await started;
  const headers = { "x-codex-rpc-token": token, "Content-Type": "application/json" };
  const busy = await fetch(root + "/api/pets/import", { method: "POST", headers, body: JSON.stringify(pack()) });
  assert.equal(busy.status, 409);
  const malformed = new Promise((resolve) => slow.once("response", (response) => { response.resume(); response.once("end", () => resolve(response.statusCode)); }));
  slow.end("{"); assert.equal(await malformed, 400);
  const next = await fetch(root + "/api/pets/import", { method: "POST", headers, body: JSON.stringify(pack()) });
  assert.equal(next.status, 200);
});

function pngFixture(color, depth, width, scanline, palette, alpha) {
  function crc(data) { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
  function chunk(name, data) { const head = Buffer.alloc(8), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); head.write(name, 4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(name), data]))); return Buffer.concat([head, data, tail]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(1, 4); header[8] = depth; header[9] = color;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), ...(palette ? [chunk("PLTE", palette)] : []), ...(alpha ? [chunk("tRNS", alpha)] : []), chunk("IDAT", deflateSync(scanline)), chunk("IEND", Buffer.alloc(0))]);
}
test("PNG uploads decode RGB/indexed/16-bit images with bounded inflation and validated chunks", () => {
  assert.deepEqual([...decodePNG(pngFixture(2, 8, 1, Buffer.from([0, 200, 50, 20]))).rgba], [200, 50, 20, 255]);
  assert.deepEqual([...decodePNG(pngFixture(3, 1, 2, Buffer.from([0, 0b01000000]), Buffer.from([255,0,0,0,255,0]), Buffer.from([0,255]))).rgba], [255,0,0,0,0,255,0,255]);
  assert.deepEqual([...decodePNG(pngFixture(0, 16, 1, Buffer.from([0,255,255]))).rgba], [255,255,255,255]);
  const good = pngFixture(2, 8, 1, Buffer.from([0, 200, 50, 20]));
  assert.throws(() => decodePNG(good.subarray(0, good.length - 2)), /Truncated|Incomplete/);
  const corrupt = Buffer.from(good); corrupt[20] ^= 1; assert.throws(() => decodePNG(corrupt), /checksum/);
  assert.throws(() => decodePNG(pngFixture(2, 8, 5000, Buffer.from([0]))), /dimensions/);
  assert.throws(() => decodePNG(pngFixture(2, 8, 1, Buffer.alloc(1000))), /buffer|length|limit/i);
});

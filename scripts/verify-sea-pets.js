// Exercise the actual standalone executable, including its worker-thread path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { encodePNG } from "../src/assets/png.js";
import { inspectGIF } from "../src/assets/gif.js";
const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const binary = path.resolve(process.argv[2] || `dist/release/${process.platform}-${process.arch}/codex-rpc-${version}-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-sea-pets-"));
fs.mkdirSync(path.join(temp, "codex"));
const child = spawn(binary, ["serve", "--port", "0"], { windowsHide: true,
  env: { ...process.env, CODEX_RPC_HOME: path.join(temp, "rpc"), CODEX_HOME: path.join(temp, "codex") }, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "", closed = false;
child.stderr.on("data", (part) => { stderr = (stderr + part).slice(-4000); });
child.once("close", () => { closed = true; });
try {
  const url = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(Error("Standalone dashboard startup timed out: " + stderr)), 15000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); reject(Error(`Standalone exited (${code}): ${stderr}`)); });
    child.stdout.on("data", (part) => {
      text = (text + part).slice(-4000);
      const match = /http:\/\/(?:localhost|127\.0\.0\.1):\d+/.exec(text);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const get = async (route) => { const r = await fetch(url + route, { signal: AbortSignal.timeout(30000) }); assert.equal(r.status, 200, route); return r; };
  const { token } = await (await get("/api/session")).json();
  const post = (route, value) => fetch(url + route, { method: "POST", headers: { "Content-Type": "application/json", "x-codex-rpc-token": token }, body: JSON.stringify(value), signal: AbortSignal.timeout(35000) });
  const width = 256, height = 224, rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 7; row++) for (let column = 0; column < 8; column++)
    for (let y = 6; y < 28; y++) for (let x = 7; x < 25; x++) {
      const at = ((row * 32 + y) * width + column * 32 + x) * 4;
      rgba.set([40 + row * 20, 80 + column * 12, 180, 255], at);
    }
  const response = await post("/api/pets/import", { name: "Standalone pet", format: "sheet-v2", image: encodePNG(width, height, rgba).toString("base64") });
  const imported = await response.json(); assert.equal(response.status, 200, JSON.stringify(imported));
  assert.equal(Object.keys(imported.pet.animations).length, 19);
  const gif = Buffer.from(await (await get(imported.pet.animations.writing.path)).arrayBuffer());
  assert.equal(inspectGIF(gif).frameCount, 8);
  const zip = Buffer.from(await (await get(`/api/pets/${imported.pet.id}/download`)).arrayBuffer());
  assert.equal(zip.readUInt32LE(), 0x04034b50);
  assert.equal((await post("/api/pets/select", { id: imported.pet.id })).status, 400);
  assert.equal((await post("/api/pets/select", { id: "codex-bloom" })).status, 200);
  const activity = await (await get("/api/presence")).json();
  assert.match(activity.assets.large_image, /\/pets\/codex-bloom\/sleeping.gif$/);
  console.log("Standalone pet import, worker, GIF/ZIP routes and builtin selection passed.");
} finally {
  child.kill("SIGTERM");
  const deadline = Date.now() + 3000;
  while (!closed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!closed) child.kill("SIGKILL");
  fs.rmSync(temp, { recursive: true, force: true });
}

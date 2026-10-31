import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { config, home, validateConfig, writeJSON } from "./store.js";
import { normalizePetBaseUrl } from "./pet-url.js";
import { corePetStates, petStateFallbacks, bloomStates } from "./pet-format.js";
import { createZip } from "./zip.js";
import { animationCatalog } from "./assets/generate-pet-gifs.js";

const repository = "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/";
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const filePattern = /^[a-z][a-z0-9-]{0,31}\.(gif|png)$/;
const cache = new Map();
const classicMetadata = Object.fromEntries(animationCatalog.map((animation) => [animation.gif, { ...animation, width: 192, height: 208, durationMs: animation.frameCount / animation.fps * 1000 }]));
let bloomMetadata;
function bundledBloomMetadata() {
  if (bloomMetadata) return bloomMetadata;
  try {
    const saved = JSON.parse(fs.readFileSync(new URL("../assets/pets/codex-bloom/manifest.json", import.meta.url), "utf8"));
    bloomMetadata = Object.fromEntries(Object.values(saved.animations || {}).map((animation) => [animation.gif, animation]));
    return bloomMetadata;
  } catch { return {}; }
}
function animationInfo(value) {
  if (!value || typeof value !== "object") return {};
  const info = { fps: value.fps, durationMs: value.durationMs, frameCount: value.frameCount ?? value.frames, width: value.width, height: value.height };
  return Object.values(info).every((number) => Number.isFinite(number) && number > 0) ? info : {};
}
let importing = false;
function invalid(message, statusCode = 400) { return Object.assign(Error(message), { statusCode }); }
function directory(id) { return path.join(home(), "pets", id); }
function regularDirectory(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid("Pet library directories must not be symbolic links");
}
function readFile(target, maxBytes) {
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw invalid("Invalid pet asset file");
  // O_NONBLOCK prevents a FIFO swapped in after lstat from hanging the local
  // HTTP event loop. The fd is checked again before any bytes are read.
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || fs.lstatSync(target).isSymbolicLink()) throw invalid("Invalid pet asset file");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function manifest(id) {
  if (!idPattern.test(id) || ["codex", "codex-bloom"].includes(id)) return null;
  const dir = directory(id), target = path.join(dir, "manifest.json");
  try {
    regularDirectory(path.dirname(dir)); regularDirectory(dir);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 65536) return null;
    const key = `${target}:${stat.mtimeMs}:${stat.size}`, prior = cache.get(target);
    if (prior?.key === key) return prior.value;
    const value = JSON.parse(readFile(target, 65536));
    if (value.schemaVersion !== 1 || value.id !== id || typeof value.name !== "string" || !value.name.length || value.name.length > 64 || !value.states || Array.isArray(value.states)) return null;
    for (const [state, file] of Object.entries(value.states))
      if (!Object.hasOwn(petStateFallbacks, state) || typeof file !== "string" || !filePattern.test(file) || !file.endsWith(".gif")) return null;
    if (corePetStates.some((state) => !value.states[state])) return null;
    cache.set(target, { key, value }); return value;
  } catch { return null; }
}
function describe({ id, name, states, builtin, baseUrl, metadata = {} }, settings = config()) {
  const prefix = id === "codex" ? "/assets/pet/" : builtin ? `/assets/pets/${id}/` : `/pets/${id}/`;
  const hosted = builtin ? baseUrl : settings.pet?.id === id ? normalizePetBaseUrl(settings.pet?.baseUrl) : "";
  const animations = Object.fromEntries(Object.entries(states).map(([state, file]) => [state, {
    ...animationInfo(metadata[file]),
    path: prefix + file,
    previewPath: prefix + file.replace(/\.gif$/, id === "codex" ? ".svg" : ".png"),
    url: hosted ? hosted + file + (id === "codex" ? "?v=smooth-1" : "") : null,
  }]));
  return { id, name, builtin, previewPath: animations.writing?.previewPath || animations.idle.previewPath, animations, requiresHosting: !builtin, baseUrl: hosted || "" };
}
export function getPet(id, settings = config()) {
  if (typeof id !== "string" || !idPattern.test(id)) return null;
  if (id === "codex") return describe({ id, name: "Codex Classic", builtin: true,
    states: Object.fromEntries(Object.keys(petStateFallbacks).map((state) => [state, `codex-pet-${state}.gif`])), baseUrl: repository + "pet/", metadata: classicMetadata }, settings);
  if (id === "codex-bloom") return describe({ id, name: "Codex Bloom", builtin: true,
    states: Object.fromEntries(Object.entries(bloomStates).map(([state, source]) => [state, `${source}.gif`])), baseUrl: repository + "pets/codex-bloom/", metadata: bundledBloomMetadata() }, settings);
  const saved = manifest(id);
  return saved ? describe({ ...saved, builtin: false }, settings) : null;
}
export function listPets(settings = config()) {
  const pets = [getPet("codex", settings), getPet("codex-bloom", settings)];
  const root = path.join(home(), "pets");
  try {
    regularDirectory(root);
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, 100)) {
      if (entry.isDirectory() && idPattern.test(entry.name)) { const pet = getPet(entry.name, settings); if (pet) pets.push(pet); }
    }
  } catch {}
  return pets;
}
export function resolvePetAsset(state, settings) {
  const id = settings.pet?.id;
  if (!id || id === "codex") return null;
  return getPet(id, settings)?.animations[state === "working" ? "writing" : state] || null;
}
export async function importPet(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Pet import must be an object");
  const name = typeof input.name === "string" ? input.name.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 64) : "";
  if (!name) throw invalid("Give your pet a name");
  if (!["sheet-v2", "legacy-v1", "gif-pack"].includes(input.format)) throw invalid("Choose a PNG sprite sheet or GIF pet pack");
  if (importing) throw invalid("Another pet is being imported. Wait for it to finish", 409);
  if (listPets().length >= 52) throw invalid("The local library is full (50 imported pets)");
  importing = true;
  let temporary;
  try {
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./pet-import-worker.js", import.meta.url), { workerData: input,
        // This module needs no loaders or parent test/SEA/debug flags. Some
        // process-level V8 flags cannot be passed to a worker at all.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(invalid("Pet import took too long. Try a smaller sheet or fewer GIF frames")), 30000);
      worker.once("message", (message) => finish(message.ok ? null : invalid(message.error), message.result));
      worker.once("error", (error) => finish(invalid(`Could not process pet image: ${error.message}`)));
      worker.once("exit", (code) => { if (!settled) finish(invalid(`Pet image worker stopped (${code}). Try smaller images`)); });
    });
    const root = path.join(home(), "pets"); fs.mkdirSync(root, { recursive: true, mode: 0o700 }); regularDirectory(root);
    const id = "pet-" + randomUUID(), destination = directory(id);
    temporary = path.join(root, ".pending-" + randomUUID()); fs.mkdirSync(temporary, { mode: 0o700 });
    for (const file of result.files) {
      if (!filePattern.test(file.name) || file.bytes.length > 1024 * 1024) throw invalid("Invalid processed pet asset");
      fs.writeFileSync(path.join(temporary, file.name), file.bytes, { mode: 0o600, flag: "wx" });
    }
    const saved = { schemaVersion: 1, id, name, states: result.states, metadata: result.metadata, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(temporary, "manifest.json"), JSON.stringify(saved, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, destination); temporary = null;
    return { pet: getPet(id), warnings: result.warnings };
  } finally { importing = false; if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
export function selectPet({ id, baseUrl = "" } = {}) {
  const pet = getPet(id);
  if (!pet) throw invalid("Pet not found");
  const normalized = pet.builtin ? "" : normalizePetBaseUrl(baseUrl);
  if (!pet.builtin && !normalized) throw invalid("Add a public HTTPS hosting folder URL before using this pet on Discord. Local previews and export work without hosting");
  const next = validateConfig({ ...config(), pet: { id, baseUrl: normalized } });
  writeJSON("config.json", next);
  return { pet: getPet(id, next), config: next };
}
export function readPetAsset(id, filename) {
  const pet = getPet(id);
  if (!pet || !filePattern.test(filename)) return null;
  const allowed = new Set(Object.values(pet.animations).flatMap((animation) => [animation.path.split("/").pop(), animation.previewPath.split("/").pop()]));
  if (!allowed.has(filename)) return null;
  let target;
  if (pet.builtin) target = fileURLToPath(new URL(`../assets/${id === "codex" ? "pet" : "pets/" + id}/${filename}`, import.meta.url));
  else { regularDirectory(path.join(home(), "pets")); regularDirectory(directory(id)); target = path.join(directory(id), filename); }
  try { return { bytes: readFile(target, 2 * 1024 * 1024), contentType: filename.endsWith(".gif") ? "image/gif" : "image/png" }; }
  catch (error) { if (error.code === "ENOENT" || error.code === "ELOOP" || error.statusCode === 400) return null; throw error; }
}
export function exportPet(id) {
  const pet = getPet(id); if (!pet) throw invalid("Pet not found", 404);
  const names = [...new Set(Object.values(pet.animations).map((animation) => animation.path.split("/").pop()))];
  const aliases = { coding: "writing", sleeping: "idle", success: "done", deploying: "installing" };
  const canonical = (name) => { const stem = name.replace(/^codex-pet-/, "").replace(/\.gif$/, ""); return `${aliases[stem] || stem}.gif`; };
  const files = names.map((name) => {
    const asset = readPetAsset(id, name); if (!asset) throw invalid("A pet asset is missing", 404);
    return { name: canonical(name), data: asset.bytes.toString("base64") };
  });
  const states = Object.fromEntries(Object.entries(pet.animations).map(([state, animation]) => [state, canonical(animation.path.split("/").pop())]));
  return { name: pet.name, format: "gif-pack", files, states };
}
export function downloadPet(id) {
  const pet = getPet(id); if (!pet) throw invalid("Pet not found", 404);
  // The original blue character has legacy SVG previews; hosting needs GIFs.
  const names = [...new Set(Object.values(pet.animations).flatMap((animation) => [animation.path.split("/").pop(), animation.previewPath.split("/").pop()]).filter((name) => filePattern.test(name)))];
  const entries = names.map((name) => { const asset = readPetAsset(id, name); if (!asset) throw invalid("A pet asset is missing", 404); return { name, data: asset.bytes }; });
  entries.push({ name: "manifest.json", data: JSON.stringify({ name: pet.name, states: Object.fromEntries(Object.entries(pet.animations).map(([state, animation]) => [state, animation.path.split("/").pop()])) }, null, 2) });
  return createZip(entries);
}

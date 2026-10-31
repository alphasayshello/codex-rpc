import { parentPort, workerData } from "node:worker_threads";
import { decodePNG, encodePNG } from "./assets/png.js";
import { decodeGIF, inspectGIF, resizeRGBA } from "./assets/gif.js";
import { encodeGIF } from "./assets/generate-pet-gifs.js";
import { corePetStates, petFileAliases, petStateFallbacks, completePetStates } from "./pet-format.js";

const maxInput = 10 * 1024 * 1024, maxTotal = 48 * 1024 * 1024, maxOutput = 1024 * 1024;
function bytes(value, mime) {
  if (typeof value !== "string") throw Error("Image data must be base64 text");
  const encoded = value.startsWith(`data:${mime};base64,`) ? value.slice(value.indexOf(",") + 1) : value;
  if (!encoded.length || encoded.length > Math.ceil(maxInput / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error("Use a valid base64 image no larger than 10 MiB");
  const result = Buffer.from(encoded, "base64");
  if (result.length > maxInput || result.toString("base64") !== encoded) throw Error("Invalid or oversized base64 image");
  return result;
}
function crop(image, column, row, columns, rows) {
  const left = Math.round(column * image.width / columns), top = Math.round(row * image.height / rows);
  const width = Math.round((column + 1) * image.width / columns) - left;
  const height = Math.round((row + 1) * image.height / rows) - top;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) image.rgba.copy(data, y * width * 4, ((top + y) * image.width + left) * 4, ((top + y) * image.width + left + width) * 4);
  return resizeRGBA(data, width, height, 192, 192);
}
function visible(frame) {
  for (let i = 3; i < frame.length; i += 4) if (frame[i] >= 128) return true;
  return false;
}
function processPet(input) {
  const files = [], states = {}, warnings = [], metadata = {};
  const save = (state, gif, first, width = 192, height = 192) => {
    if (gif.length > maxOutput) throw Error(`The ${state} animation exceeds 1 MiB after optimization; use fewer frames or a smaller GIF`);
    if (!visible(first)) throw Error(`The ${state} animation is blank. Check the sheet's row order and transparency`);
    files.push({ name: `${state}.gif`, bytes: gif }, { name: `${state}.png`, bytes: encodePNG(width, height, first) });
    states[state] = `${state}.gif`;
    const info = inspectGIF(gif, { maxBytes: maxOutput, maxDimension: 1024, maxFrames: 600, maxSourcePixels: 100_000_000 });
    metadata[`${state}.gif`] = { width: info.width, height: info.height, frameCount: info.frameCount, durationMs: info.durationMs, fps: Math.round(info.frameCount * 100000 / info.durationMs) / 100 };
  };
  if (["sheet-v2", "legacy-v1"].includes(input.format)) {
    const image = decodePNG(bytes(input.image, "image/png"), { maxDimension: 4096, maxPixels: 8_388_608 });
    const legacy = input.format === "legacy-v1", rows = legacy ? 9 : 7;
    if (image.width < 256 || image.height < rows * 32) throw Error("The sprite sheet is too small. Use eight columns and seven rows, ideally 1536 × 1344 pixels");
    const expectedRatio = legacy ? 1536 / 1872 : 1536 / 1344;
    if (Math.abs(image.width / image.height / expectedRatio - 1) > 0.3) throw Error(`The image does not look like an eight-column, ${rows}-row sheet. Check the grid or select the correct format`);
    if (image.width !== 1536 || image.height !== (legacy ? 1872 : 1344)) warnings.push("The uploaded sheet was resized by cell. Check every animation for alignment before using it.");
    const rowMap = legacy ? { idle: 0, thinking: 6, waiting: 3, writing: 7, patching: 4, error: 5, done: 8 } : Object.fromEntries(corePetStates.map((state, index) => [state, index]));
    for (const state of corePetStates) {
      // Legacy idle column 0 is awake; retain only its sleeping cycle.
      const columns = Array.from({ length: legacy && state === "idle" ? 7 : 8 }, (_, index) => index + (legacy && state === "idle" ? 1 : 0));
      const frames = columns.map((column) => crop(image, column, rowMap[state], 8, rows));
      if (frames.some((frame) => !visible(frame))) throw Error(`The ${state} row contains an empty frame. Fill every cell or choose the matching sheet format`);
      save(state, encodeGIF(frames, 192, 192, frames.map(() => 10)), frames[0]);
    }
    warnings.push("Imported artwork is played as drawn. Check for face, body or prop drift; the importer cannot repair inconsistent generated frames.");
  } else if (input.format === "gif-pack") {
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 20) throw Error("Choose one to twenty named GIF animations");
    let total = 0;
    for (const file of input.files) {
      if (!file || typeof file.name !== "string" || !/^[a-z][a-z0-9-]{0,31}\.gif$/.test(file.name)) throw Error("GIF filenames must be state names without folders, for example writing.gif");
      const rawState = file.name.slice(0, -4), state = petFileAliases[rawState] || rawState;
      if (!Object.hasOwn(petStateFallbacks, state)) throw Error(`Unknown pet state: ${rawState}`);
      if (states[state]) throw Error(`More than one GIF supplies ${state}`);
      const data = bytes(file.data, "image/gif"); total += data.length;
      if (total > maxTotal) throw Error("GIF files must total no more than 48 MiB");
      const limits = { maxBytes: maxInput, maxDimension: 1024, maxFrames: 600, maxSourcePixels: 100_000_000, maxOutputPixels: 12_000_000 };
      const info = inspectGIF(data, limits);
      const scale = 192 / Math.max(info.width, info.height), width = Math.max(1, Math.round(info.width * scale)), height = Math.max(1, Math.round(info.height * scale));
      const preserve = data.length <= maxOutput && info.width <= 512 && info.height <= 512;
      const decoded = decodeGIF(data, { ...limits, outputWidth: width, outputHeight: height, sampleMs: preserve ? info.durationMs + 1 : Math.max(100, info.durationMs / 120) });
      let optimized = preserve ? data : encodeGIF(decoded.frames, width, height, decoded.delays);
      let first = decoded.frames[0], savedWidth = width, savedHeight = height;
      for (const size of [160, 128, 96]) {
        if (optimized.length <= maxOutput) break;
        const factor = size / Math.max(width, height);
        savedWidth = Math.max(1, Math.round(width * factor)); savedHeight = Math.max(1, Math.round(height * factor));
        const frames = decoded.frames.map((frame) => resizeRGBA(frame, width, height, savedWidth, savedHeight));
        optimized = encodeGIF(frames, savedWidth, savedHeight, decoded.delays); first = frames[0];
      }
      if (!preserve && Math.max(savedWidth, savedHeight) < 192) warnings.push(`${state} was resized to ${savedWidth} × ${savedHeight} to keep its GIF below 1 MiB.`);
      save(state, optimized, first, savedWidth, savedHeight);
    }
    for (const state of ["idle", "thinking", "writing", "error", "done"]) if (!states[state]) throw Error(`Missing ${state}. Include idle/sleeping, thinking, writing/coding, error and done/success GIFs`);
    for (const state of ["waiting", "patching"]) if (!states[state]) warnings.push(`${state} uses the ${petStateFallbacks[state]} animation because no separate GIF was provided.`);
  } else throw Error("Choose a PNG sprite sheet or an exported GIF pet pack");
  const completed = completePetStates(states);
  if (input.format === "gif-pack" && input.states !== undefined) {
    if (!input.states || typeof input.states !== "object" || Array.isArray(input.states)) throw Error("Invalid pet state map");
    const available = new Set(Object.values(states));
    for (const [state, file] of Object.entries(input.states)) {
      if (!Object.hasOwn(petStateFallbacks, state) || typeof file !== "string" || !available.has(file)) throw Error("Pet state map refers to an unknown animation");
      completed[state] = file;
    }
  }
  return { files, states: completed, metadata, warnings };
}

try { parentPort.postMessage({ ok: true, result: processPet(workerData) }); }
catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }

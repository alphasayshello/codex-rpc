// Cross-process metadata inbox. Writers never wait for another hook: the daemon
// or the current lock owner drains complete JSON records into the state files.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { home, alive, writeJSON } from "./store.js";
const maxBytes = 65536;
const queueDirectory = () => path.join(home(), "events");
const lockFile = () => path.join(home(), "event-drain.lock");
function lock(recoverAbandoned) {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  const target = lockFile(), owner = { pid: process.pid, nonce: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = fs.openSync(target, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(owner));
      fs.closeSync(descriptor);
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(target, "utf8"));
          if (current.nonce === owner.nonce) fs.unlinkSync(target);
        } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
      };
    } catch (error) {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
      if (error.code !== "EEXIST") throw error;
      // A just-created file may not contain its owner yet. Never steal a live
      // writer's lease; recover only abandoned or old incomplete lock files.
      if (!recoverAbandoned) return null;
      let contents, stat;
      try { stat = fs.statSync(target); contents = fs.readFileSync(target, "utf8"); }
      catch (readError) { if (readError.code === "ENOENT") continue; throw readError; }
      let previous;
      try { previous = JSON.parse(contents); } catch {}
      if (alive(previous?.pid) || Date.now() - stat.mtimeMs < 1000) return null;
      try {
        // Recheck owner bytes immediately before reclaiming a dead lease.
        if (fs.readFileSync(target, "utf8") !== contents) return null;
        fs.unlinkSync(target);
      } catch (unlinkError) { if (unlinkError.code !== "ENOENT") throw unlinkError; }
    }
  }
  return null;
}
function pending() {
  try { return fs.readdirSync(queueDirectory()).filter((name) => /^\d{16}-\d+-[a-f0-9-]{36}\.json$/.test(name)).sort(); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
export function queuedEventCount() { return pending().length; }
export function drainEvents(apply, { limit = 128, budgetMs = 100, target, recoverAbandoned = true } = {}) {
  if (!queuedEventCount()) return { processed: 0, queued: 0, result: null };
  const release = lock(recoverAbandoned);
  if (!release) return { processed: 0, queued: queuedEventCount(), result: null };
  const began = Date.now();
  let processed = 0, result = null;
  try {
    while (processed < limit && Date.now() - began < budgetMs) {
      const names = pending();
      if (!names.length) break;
      for (const name of names) {
        if (processed >= limit || Date.now() - began >= budgetMs) break;
        const filename = path.join(queueDirectory(), name);
        let event;
        try {
          if (fs.statSync(filename).size > maxBytes) { fs.unlinkSync(filename); processed++; continue; }
          event = JSON.parse(fs.readFileSync(filename, "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (event && typeof event === "object" && !Array.isArray(event) && typeof event.type === "string") {
          const value = apply(event);
          if (name === target) result = value;
        }
        fs.rmSync(filename, { force: true });
        processed++;
      }
    }
    return { processed, queued: queuedEventCount(), result };
  } finally { release(); }
}
export function dispatchEvent(event, apply) {
  const bytes = JSON.stringify(event);
  if (Buffer.byteLength(bytes) > maxBytes) throw Error("Normalized hook event exceeds 64 KiB");
  const name = `${String(Date.now()).padStart(16, "0")}-${process.pid}-${randomUUID()}.json`;
  writeJSON(`events/${name}`, event);
  return drainEvents(apply, { target: name, recoverAbandoned: false }).result;
}

import fs from "node:fs";
import path from "node:path";

// Native directory watches can fail asynchronously (notably EPERM on Windows
// when a directory is removed). A bounded, unref'ed async stat loop also catches
// missed notifications and reattaches after directory replacement/recreation.
export function watchDirectory(directory, filenames, onChange, {
  pollMs = 1000,
  onError = () => {},
  watch = fs.watch,
  stat = fs.promises.stat,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const names = [...new Set(filenames)];
  if (names.some((name) => typeof name !== "string" || !name || name === "." || name === ".." || /[\\/]/.test(name)))
    throw new Error("Watch filenames must be direct directory entries");
  if (!Number.isFinite(pollMs) || pollMs < 1) throw new Error("Invalid watch poll interval");
  const known = new Set(names), previous = new Map();
  let closed = false, native = null, identity = null, initialized = false, inFlight = null, timer, lastError = null;
  const report = (error) => {
    if (closed) return;
    lastError = error;
    try { onError(error); } catch {}
  };
  const notify = (name) => {
    if (closed || !known.has(name)) return;
    try { Promise.resolve(onChange(name)).catch(report); } catch (error) { report(error); }
  };
  const stopNative = () => {
    const old = native;
    native = null;
    try { old?.close(); } catch (error) { report(error); }
  };
  const startNative = () => {
    if (closed || native || !identity) return;
    try {
      const current = watch(directory, (_, name) => {
        if (closed) return;
        if (name == null) { void poll(); return; }
        notify(Buffer.isBuffer(name) ? name.toString() : String(name));
      });
      native = current;
      // Keep the error listener even after close: a queued error can still fire.
      current.on("error", (error) => {
        if (closed || native !== current) return;
        report(error);
        stopNative();
      });
      current.on("close", () => { if (native === current) native = null; });
      current.unref?.();
    } catch (error) { report(error); }
  };
  const inspect = async (target) => {
    try { return await stat(target); }
    catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) report(error);
      return null;
    }
  };
  function poll() {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const [dir, ...files] = await Promise.all([inspect(directory), ...names.map((name) => inspect(path.join(directory, name)))]);
      if (closed) return;
      const nextIdentity = dir ? `${dir.dev}:${dir.ino}:${dir.birthtimeMs}` : null;
      if (nextIdentity !== identity) { stopNative(); identity = nextIdentity; }
      for (let i = 0; i < names.length; i++) {
        const value = files[i];
        const fingerprint = value ? `${value.dev}:${value.ino}:${value.mtimeMs}:${value.ctimeMs}:${value.size}` : null;
        if (initialized && previous.get(names[i]) !== fingerprint) notify(names[i]);
        previous.set(names[i], fingerprint);
      }
      initialized = true;
      startNative();
    })().catch(report).finally(() => { inFlight = null; });
    return inFlight;
  }
  timer = setIntervalFn(() => { void poll(); }, pollMs);
  timer.unref?.();
  void poll();
  return {
    poll,
    get lastError() { return lastError; },
    close() {
      if (closed) return;
      closed = true;
      clearIntervalFn(timer);
      stopNative();
    },
  };
}

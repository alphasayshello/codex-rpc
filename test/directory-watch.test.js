import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { watchDirectory } from "../src/directory-watch.js";
import { serve } from "../src/server.js";
import { sandbox } from "./helpers.js";

function fakeNative() {
  const handles = [];
  const watch = (_directory, callback) => {
    const handle = new EventEmitter();
    handle.callback = callback;
    handle.close = () => { handle.closed = true; handle.emit("close"); };
    handle.unref = () => { handle.unrefed = true; };
    handles.push(handle);
    return handle;
  };
  return { handles, watch };
}
function manualTimer() {
  let callback;
  const timer = { unref() { this.unrefed = true; } };
  return {
    timer,
    setIntervalFn(fn) { callback = fn; return timer; },
    clearIntervalFn(value) { assert.equal(value, timer); callback = null; timer.cleared = true; },
    tick() { callback?.(); },
  };
}
const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });

test("queued Windows EPERM is absorbed; stat fallback detects newest changes and recreation", async (t) => {
  const native = fakeNative(), clock = manualTimer(), changed = [], errors = [];
  let directoryId = 1, version = 1;
  const stat = async (target) => {
    if (!directoryId) throw missing();
    return target === "/rpc" ? { dev: 1, ino: directoryId, birthtimeMs: directoryId }
      : { dev: 1, ino: version, mtimeMs: version, ctimeMs: version, size: version };
  };
  const observer = watchDirectory("/rpc", ["state.json"], (name) => changed.push(name), {
    ...native, ...clock, stat, onError: (error) => errors.push(error.code),
  });
  t.after(() => observer.close());
  await observer.poll();
  assert.equal(native.handles.length, 1);
  assert.equal(clock.timer.unrefed, true);
  assert.equal(native.handles[0].unrefed, true);
  native.handles[0].callback("change", Buffer.from("state.json"));
  native.handles[0].callback("change", "unrelated.tmp");
  assert.deepEqual(changed, ["state.json"]);
  native.handles[0].emit("error", Object.assign(new Error("watch denied"), { code: "EPERM" }));
  assert.equal(native.handles[0].closed, true);
  version = 5; // Counter storms have one latest stat observation.
  await observer.poll();
  assert.deepEqual(changed, ["state.json", "state.json"]);
  assert.deepEqual(errors, ["EPERM"]);
  directoryId = 0;
  await observer.poll();
  assert.equal(native.handles.at(-1).closed, true);
  directoryId = 2;
  version = 8;
  await observer.poll();
  assert.equal(native.handles.length, 3);
  assert.equal(changed.length, 4); // Change, removal and recreation are visible.
  observer.close();
  for (const handle of native.handles) assert.doesNotThrow(() => handle.emit("error", Object.assign(new Error("late EPERM"), { code: "EPERM" })));
  assert.equal(clock.timer.cleared, true);
  assert.equal(changed.length, 4);
});

test("watch startup failures fall back without unhandled errors or overlapping polls", async (t) => {
  const clock = manualTimer(), changed = [];
  let version = 1, calls = 0;
  const observer = watchDirectory("/rpc", ["state.json"], (name) => changed.push(name), {
    ...clock,
    watch() { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
    stat: async () => { calls++; return { dev: 1, ino: 1, birthtimeMs: 1, mtimeMs: version, ctimeMs: version, size: version }; },
  });
  t.after(() => observer.close());
  await observer.poll();
  assert.equal(observer.lastError.code, "EPERM");
  calls = 0;
  version = 2;
  await Promise.all([observer.poll(), observer.poll(), observer.poll()]);
  assert.equal(calls, 2); // One directory plus one known file, not three loops.
  assert.deepEqual(changed, ["state.json"]);
});

test("closing before pending I/O resolves prevents callbacks, native watches and timer leaks", async () => {
  const native = fakeNative(), clock = manualTimer(), changed = [];
  const pending = [];
  const observer = watchDirectory("/rpc", ["state.json"], (name) => changed.push(name), {
    ...native, ...clock, stat: () => new Promise((resolve) => pending.push(resolve)),
  });
  const poll = observer.poll();
  observer.close();
  for (const resolve of pending) resolve({ dev: 1, ino: 1, birthtimeMs: 1, mtimeMs: 1, ctimeMs: 1, size: 1 });
  await poll;
  clock.tick();
  assert.deepEqual(changed, []);
  assert.equal(native.handles.length, 0);
  assert.equal(clock.timer.cleared, true);
  await observer.poll();
});

test("real deleted/recreated directory recovers and reports changes with native watch unavailable", async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-watch-")), directory = path.join(temp, "rpc");
  const changed = [], clock = manualTimer();
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "state.json"), "one");
  const observer = watchDirectory(directory, ["state.json"], (name) => changed.push(name), {
    ...clock, watch() { throw Object.assign(new Error("unsupported watch"), { code: "EPERM" }); },
  });
  t.after(() => { observer.close(); fs.rmSync(temp, { recursive: true, force: true }); });
  await observer.poll();
  fs.rmSync(directory, { recursive: true });
  await observer.poll();
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "state.json"), "latest restored state");
  await observer.poll();
  assert.deepEqual(changed, ["state.json", "state.json"]);
  assert.equal(fs.readFileSync(path.join(directory, "state.json"), "utf8"), "latest restored state");
});

test("dashboard close immediately releases watches, drains SSE and returns one awaitable shutdown", async (t) => {
  let server, controller;
  t.after(async () => { controller?.abort(); await server?.closeDashboard(); });
  const { rpc } = sandbox(t);
  server = await serve(0);
  controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  let called = 0;
  const closing = server.closeDashboard(() => { called++; });
  assert.equal(server.closeDashboard(), closing);
  // Matches the Windows cleanup race that previously emitted uncaught EPERM.
  fs.rmSync(rpc, { recursive: true, force: true });
  await closing;
  assert.equal(called, 1);
  assert.equal(server.listening, false);
});

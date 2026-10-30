import fs from "node:fs";
import net from "node:net";
import { frame } from "../src/ipc.js";
import os from "node:os";
import path from "node:path";
export function sandbox(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-test-"));
  const prior = {
    CODEX_RPC_HOME: process.env.CODEX_RPC_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
  };
  process.env.CODEX_RPC_HOME = path.join(temp, "rpc");
  process.env.CODEX_HOME = path.join(temp, "codex");
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
  t.after(() => {
    for (const [k, v] of Object.entries(prior))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return {
    temp,
    rpc: process.env.CODEX_RPC_HOME,
    codex: process.env.CODEX_HOME,
    env: { ...process.env, HOME: temp,
      USERPROFILE:temp, APPDATA: path.join(temp, "AppData") },
  };
}
export function jsonl(filename, rows) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(
    filename,
    rows.map((x) => JSON.stringify(x)).join("\n") + "\n",
  );
  return filename;
}
export async function until(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timed out waiting for condition");
}

export async function mockDiscord(t, socket) {
  const received = [],
    peers = new Set();
  let handshakes = 0;
  const server = net.createServer((peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.on("close", () => peers.delete(peer));
    let buffer = Buffer.alloc(0);
    peer.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (
        buffer.length >= 8 &&
        buffer.length >= 8 + buffer.readUInt32LE(4)
      ) {
        const op = buffer.readUInt32LE(0),
          size = buffer.readUInt32LE(4),
          raw = buffer.subarray(8, 8 + size);
        buffer = buffer.subarray(8 + size);
        if (op === 0) {
          handshakes++;
          const ready = frame(1, { evt: "READY", data: { user: { id: "1" } } });
          peer.write(ready.subarray(0, 3));
          setTimeout(() => {
            if (!peer.destroyed) peer.write(ready.subarray(3));
          }, 5);
        } else if (op === 1) {
          const body = JSON.parse(raw);
          received.push(body);
          peer.write(frame(1, { cmd: body.cmd, nonce: body.nonce, data: {} }));
        } else if (op === 4) received.push({ pong: JSON.parse(raw) });
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await new Promise((r) => server.close(r));
  });
  return {
    received,
    peers,
    get handshakes() {
      return handshakes;
    },
  };
}

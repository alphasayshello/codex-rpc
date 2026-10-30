import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
export function frame(opcode, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode);
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}
export function socketPaths(platform = process.platform, env = process.env) {
  if (env.CODEX_RPC_IPC) return [env.CODEX_RPC_IPC];
  if (platform === "win32")
    return Array.from(
      { length: 10 },
      (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`,
    );
  const dirs = [
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    os.tmpdir(),
    "/tmp",
    `/run/user/${process.getuid?.()}`,
  ].filter(Boolean);
  const all = [
    ...dirs,
    ...dirs.flatMap((d) => [
      path.join(d, "app/com.discordapp.Discord"),
      path.join(d, "snap.discord"),
    ]),
  ];
  return [...new Set(all)].flatMap((d) =>
    Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)),
  );
}
export class DiscordIPC extends EventEmitter {
  constructor(clientId, { paths = socketPaths(), timeout = 1500 } = {}) {
    super();
    this.clientId = clientId;
    this.paths = paths;
    this.timeout = timeout;
    this.ready = false;
    this.pending = new Map();
  }
  async connect() {
    this.cancelled = false;
    if (!/^\d{5,22}$/.test(this.clientId))
      throw Error("Set a Discord application clientId in config.json");
    for (const socketPath of this.paths) {
      if (this.cancelled) throw Error("Discord connection cancelled");
      try {
        await this.open(socketPath);
        return this;
      } catch (e) {
        this.lastError = e;
        this.socket?.destroy();
      }
    }
    throw Error(
      `Discord IPC unavailable: ${this.lastError?.message || "no sockets"}`,
    );
  }
  open(socketPath) {
    return new Promise((resolve, reject) => {
      this.buffer = Buffer.alloc(0);
      const s = net.createConnection(socketPath);
      this.socket = s;
      const timer = setTimeout(() => {
        s.destroy();
        reject(Error("Discord handshake timeout"));
      }, this.timeout);
      let settled = false;
      const fail = (e) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(e);
        } else this.emit("fault", e);
      };
      s.on("error", fail);
      s.on("connect", () =>
        s.write(frame(0, { v: 1, client_id: this.clientId })),
      );
      s.on("close", () => {
        clearTimeout(timer);
        if (this.socket === s) this.ready = false;
        if (this.socket === s)
          for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(Error("Discord disconnected"));
          }
        if (this.socket === s) this.pending.clear();
        if (!settled) {
          settled = true;
          reject(Error("Discord closed before READY"));
        }
        this.emit("disconnect");
      });
      s.on("data", (chunk) => {
        if (this.socket !== s || this.cancelled) return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        try {
          while (this.buffer.length >= 8) {
            const op = this.buffer.readUInt32LE(0),
              len = this.buffer.readUInt32LE(4);
            if (len > 1024 * 1024) throw Error("Oversized Discord frame");
            if (this.buffer.length < len + 8) break;
            const raw = this.buffer.subarray(8, len + 8);
            this.buffer = this.buffer.subarray(len + 8);
            if (op === 3) {
              s.write(
                Buffer.concat([
                  Buffer.from([
                    4,
                    0,
                    0,
                    0,
                    len & 255,
                    (len >>> 8) & 255,
                    (len >>> 16) & 255,
                    (len >>> 24) & 255,
                  ]),
                  raw,
                ]),
              );
              continue;
            }
            if (op === 2) {
              s.destroy();
              continue;
            }
            const msg = JSON.parse(raw.toString());
            if (msg.evt === "READY") {
              clearTimeout(timer);
              settled = true;
              this.ready = true;
              resolve();
            }
            if (msg.nonce && this.pending.has(msg.nonce)) {
              const p = this.pending.get(msg.nonce);
              clearTimeout(p.timer);
              this.pending.delete(msg.nonce);
              msg.evt === "ERROR"
                ? p.reject(Error(msg.data?.message || "Discord error"))
                : p.resolve(msg);
            }
            this.emit("message", msg);
          }
        } catch (e) {
          fail(e);
          s.destroy();
        }
      });
    });
  }
  setActivity(activity) {
    if (!this.ready) return Promise.reject(Error("Discord is not ready"));
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(Error("SET_ACTIVITY timeout"));
      }, 5000);
      this.pending.set(nonce, { resolve, reject, timer });
      this.socket.write(
        frame(1, {
          cmd: "SET_ACTIVITY",
          args: { pid: process.pid, activity },
          nonce,
        }),
      );
    });
  }
  close() {
    this.cancelled = true;
    this.ready = false;
    this.socket?.destroy();
  }
}
export { buildActivity } from "./presence.js";
export function existingSockets() {
  return socketPaths().filter(
    (p) => process.platform === "win32" || fs.existsSync(p),
  );
}

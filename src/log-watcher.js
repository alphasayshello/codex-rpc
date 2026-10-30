// Live log tailing is independent of the short-lived lifetime scanner. No
// prompt/tool argument content is persisted; only normalized state survives.
import fs from "node:fs";
import path from "node:path";
import { codexHome, config, readJSON } from "./store.js";
import { walk } from "./scanner.js";
import { applyEvent, normalizeEvent } from "./hook.js";
export class LogWatcher {
  constructor() {
    this.files = new Map();
  }
  poll() {
    const c = config();
    if (!c.enabled) return;
    for (const filename of walk(path.join(codexHome(), "sessions"))) {
      let stat;
      try {
        stat = fs.statSync(filename);
      } catch {
        continue;
      }
      if (Date.now() - stat.mtimeMs > c.timing.idleMs) continue;
      let info = this.files.get(filename);
      if (!info || stat.size < info.offset || stat.ino !== info.ino)
        info = {
          offset: 0,
          ino: stat.ino,
          rest: "",
          context: { sessionId: path.basename(filename) },
        };
      if (stat.size === info.offset) continue;
      // Limit each read to 1 MiB; remaining data is picked up on the next tick.
      const length = Math.min(stat.size - info.offset, 1024 * 1024),
        buf = Buffer.alloc(length),
        fd = fs.openSync(filename, "r");
      try {
        fs.readSync(fd, buf, 0, length, info.offset);
      } finally {
        fs.closeSync(fd);
      }
      const text = info.rest + buf.toString("utf8"),
        lines = text.split("\n");
      info.rest = lines.pop();
      info.offset += length;
      if (info.rest.length > 1024 * 1024) info.rest = "";
      for (const line of lines) {
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const p = row.payload || row;
        if (row.type === "session_meta") {
          info.context.sessionId = p.id || info.context.sessionId;
          info.context.cwd = p.cwd;
        }
        if (p.model) info.context.model = p.model;
        if (Date.now() - Date.parse(row.timestamp || "") > c.timing.idleMs)
          continue;
        const event = { ...info.context, ...row };
        if (normalizeEvent(event)) applyEvent(event);
        else if (p.type === "token_count" && p.info?.total_token_usage) {
          const current = readJSON("codex-state.json");
          applyEvent({
            ...info.context,
            type: current.status || "thinking",
            timestamp: row.timestamp,
            tokens: p.info.total_token_usage.total_tokens,
          });
        }
      }
      this.files.set(filename, info);
    }
  }
}

// Read the chat name Codex actually shows, without a database or SDK.
import fs from "node:fs";
import path from "node:path";
import { codexHome } from "./store.js";
let cachedPath,
  stamp,
  names = new Map();
export function conversationName(sessionId) {
  if (!sessionId) return undefined;
  const filename = path.join(codexHome(), "session_index.jsonl");
  try {
    const stat = fs.statSync(filename),
      next = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (filename !== cachedPath || stamp !== next) {
      const parsed = new Map();
      for (const line of fs.readFileSync(filename, "utf8").split("\n")) {
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const id = row.id || row.thread_id || row.session_id,
          value = row.thread_name || row.name;
        if (typeof id !== "string" || typeof value !== "string") continue;
        const title = value
          .replace(/\x1b\[[0-9;]*m/g, "")
          .replace(/[\x00-\x1f\x7f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 128);
        const updated = Date.parse(row.updated_at) || 0,
          prior = parsed.get(id);
        if (title && (!prior || updated >= prior.updated))
          parsed.set(id, { title, updated });
      }
      cachedPath = filename;
      stamp = next;
      names = parsed;
    }
    return names.get(sessionId)?.title;
  } catch {
    return undefined;
  }
}

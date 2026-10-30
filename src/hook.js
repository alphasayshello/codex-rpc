import fs from "node:fs";
import path from "node:path";
import { isMain, readJSON, writeJSON, config, file } from "./store.js";
const states = {
  working: "working",
  thinking: "thinking",
  waiting: "waiting",
  idle: "idle",
  "session-start": "waiting",
  "turn-start": "thinking",
  task_started: "thinking",
  user_message: "thinking",
  "tool-start": "working",
  function_call: "working",
  custom_tool_call: "working",
  "tool-end": "thinking",
  "approval-request": "waiting",
  "agent-turn-complete": "waiting",
  task_complete: "waiting",
  "session-end": "idle",
  "app-background": "idle",
  "app-closed": "idle",
  "app-active": "waiting",
};
export function normalizeEvent(input) {
  const p = input.payload || input;
  const type = p.type || input.type;
  let status = states[type];
  if (
    type === "reasoning" ||
    (p.role === "assistant" && p.content?.some?.((x) => x.type === "reasoning"))
  )
    status = "thinking";
  if (p.role === "user") status = "thinking";
  if (!status) return null;
  return {
    status,
    source: input.source || p.source || "codex",
    sessionId: input["thread-id"] || p.session_id || input.sessionId,
    project:
      input.project ||
      (input.cwd || p.cwd ? path.basename(input.cwd || p.cwd) : undefined),
    model: input.model || p.model,
    tool: input.tool || p.name,
    tokens: input.tokens ?? p.info?.total_token_usage?.total_tokens,
    timestamp: input.timestamp,
  };
}
export function applyEvent(input) {
  const e = normalizeEvent(input);
  if (!e) return null;
  const c = config();
  if (!c.enabled) return null;
  // Independent source files avoid lost read-modify-write updates from concurrent hooks.
  const source = e.source === "chatgpt" ? "chatgpt" : "codex";
  const prior = readJSON(`${source}-state.json`);
  const time = Date.now(),
    eventTime = Date.parse(e.timestamp) || time;
  if (
    prior.eventTime > eventTime ||
    (e.timestamp && prior.eventTime === eventTime && prior.status === e.status)
  )
    return prior;
  const next = {
    ...prior,
    status: e.status,
    source,
    updatedAt: time,
    eventTime,
    startedAt:
      !prior.startedAt || (e.sessionId && e.sessionId !== prior.sessionId)
        ? time
        : prior.startedAt,
  };
  for (const k of ["sessionId", "project", "model", "tool", "tokens"])
    if (e[k] !== undefined) next[k] = e[k];
  if (e.status !== "working") delete next.tool;
  if (c.privacy === "private") {
    delete next.project;
    delete next.file;
  }
  writeJSON(`${source}-state.json`, next);
  const other = readJSON(
    `${source === "codex" ? "chatgpt" : "codex"}-state.json`,
  );
  const selected =
    source === "chatgpt" &&
    other.source === "codex" &&
    time - other.updatedAt < c.timing.idleMs &&
    (e.status === "idle" || ["working", "thinking"].includes(other.status))
      ? other
      : next;
  writeJSON("state.json", selected);
  return next;
}
export async function main() {
  let data = process.argv[2];
  if (!data) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1024 * 1024) throw Error("Hook input exceeds 1 MiB");
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks).toString();
  }
  if (Buffer.byteLength(data || "") > 1024 * 1024)
    throw Error("Hook input exceeds 1 MiB");
  for (const line of (data || "").split("\n").filter(Boolean))
    applyEvent(JSON.parse(line));
}
if (isMain(import.meta.url))
  main().catch((e) => {
    console.error(`codex-rpc hook: ${e.message}`);
    process.exitCode = 1;
  });

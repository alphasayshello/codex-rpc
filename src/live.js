import { createHash } from "node:crypto";
import { readJSON } from "./store.js";

export function liveSessionFile(sessionId, source = "codex") {
  const kind = source === "chatgpt" ? "chatgpt" : "codex";
  const hash = createHash("sha256").update(String(sessionId)).digest("hex");
  return `live/${kind}-${hash}.json`;
}
export function readLiveSession(sessionId, source = "codex") {
  return sessionId ? readJSON(liveSessionFile(sessionId, source)) : {};
}

// Reasoning is part of output; cached input is part of input. Neither is added
// twice when a provider omits total_tokens.
export function normalizeUsage(value) {
  if (!value || typeof value !== "object") return undefined;
  const count = (...values) => {
    const value = values.find((v) => v !== undefined && v !== null);
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  };
  const input = count(value.input, value.input_tokens);
  const output = count(value.output, value.output_tokens);
  return {
    input,
    output,
    reasoning: count(value.reasoning, value.reasoning_output_tokens, value.output_tokens_details?.reasoning_tokens),
    cached: count(value.cached, value.cached_input_tokens, value.input_tokens_details?.cached_tokens),
    total: count(value.total ?? value.total_tokens ?? input + output),
  };
}

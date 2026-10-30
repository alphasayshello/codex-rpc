// Official Codex hooks are observational inputs. This adapter never emits a
// permission/block decision and never retains prompt, assistant or tool output.
const events = {
  SessionStart: "session-start",
  UserPromptSubmit: "turn-start",
  PreToolUse: "tool-start",
  PostToolUse: "tool-end",
  PermissionRequest: "approval-request",
  Stop: "task_complete",
  Interrupt: "turn_aborted",
  SessionEnd: "session-end",
  PreCompact: "thinking",
  PostCompact: "thinking",
};
export const isNativeEvent = (input) => !!input && typeof input === "object" && typeof input.hook_event_name === "string";
const text = (value, max = 256) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max) : undefined;
export function nativeEvent(input) {
  if (!isNativeEvent(input)) return input;
  const type = input.hook_event_name === "SessionStart" && input.source === "compact" ? "thinking"
    : Object.hasOwn(events, input.hook_event_name) ? events[input.hook_event_name] : null;
  // SubagentStart/Stop and unknown future events cannot alter parent lifecycle.
  if (!type) return null;
  const name = text(input.tool_name, 128);
  const tool = name === "Bash" ? "bash" : name;
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  return {
    type, nativeHook: true, source: "codex",
    ...((input.hook_event_name === "SessionStart" && input.source !== "compact") || input.hook_event_name === "Interrupt" ? { waitingReason: "ready" } : {}),
    sessionId: text(input.session_id), turnId: text(input.turn_id),
    cwd: text(input.cwd, 4096), model: text(input.model, 128),
    tool, callId: text(input.tool_use_id),
    arguments: args,
    // Both native Bash and apply_patch use tool_input.command. Patch arguments
    // are inspected by the existing metadata-only telemetry parser in memory.
    ...(tool === "apply_patch" && typeof args.command === "string" ? { input: args.command } : {}),
    ...(input.hook_event_name === "PostToolUse" ? { output: input.tool_response } : {}),
    ...(typeof input.timestamp === "number" || typeof input.timestamp === "string" ? { timestamp: input.timestamp } : {}),
  };
}

import { getChatStats } from "./chat.js";
import { conversationName } from "./threads.js";
// Compact, Claude-RPC-style card text. No network access or raw prompt storage.
export const ASSET_BASE =
  "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet";
export function taskTitle(value) {
  if (Array.isArray(value))
    value = value
      .map((x) => (typeof x === "string" ? x : x?.text || ""))
      .join("\n");
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  // Codex injects user-role environment/context blocks; those are not tasks.
  if (
    /^\s*<(environment_context|codex_internal_context|permissions|INSTRUCTIONS|user_instructions)\b/i.test(
      text,
    )
  )
    return undefined;
  const line = text
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("<") && !s.startsWith("```"));
  if (
    line &&
    /^(yes|no|ok|okay|sure|thanks|thank you|continue|resume|pushed|done|[1yn])[.! ]*$/i.test(
      line,
    )
  )
    return undefined;
  return (
    line
      ?.replace(/^\/goal\s+/, "")
      .replace(/\s+/g, " ")
      .slice(0, 128) || undefined
  );
}
const compact = (value) => {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1000) return String(Math.round(n));
  for (const [unit, scale, digits] of [["k", 1e3, 1], ["M", 1e6, 2], ["B", 1e9, 2], ["T", 1e12, 2]]) {
    const rounded = (n / scale).toFixed(digits);
    if (Number(rounded) < 1000 || unit === "T") return rounded + unit;
  }
};
const hoursLabel = (seconds) => {
  if (!seconds) return "0h";
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : minutes < 600 ? `${(minutes / 60).toFixed(1)}h` : `${Math.round(minutes / 60)}h`;
};
const money = (n) => {
  n = Math.max(0, Number(n) || 0);
  return (
    "$" +
    (n >= 1000
      ? Intl.NumberFormat("en", {
          notation: "compact",
          maximumFractionDigits: 2,
        })
          .format(n)
          .toLowerCase()
      : n.toFixed(n < 10 ? 2 : 1))
  );
};
export function statusBadgeKind(state = {}) {
  const tool = String(state.tool || "").toLowerCase();
  if (state.status === "waiting")
    return state.waitingReason === "approval"
      ? "approval"
      : state.waitingReason === "error"
        ? "error"
        : state.waitingReason === "done"
          ? "waiting"
          : "ready";
  if (state.status === "working") {
    if (/edit|patch|write/.test(tool)) return "editing";
    if (/read|search|grep|list|find/.test(tool)) return "reading";
    if (/review|verify/.test(tool)) return "review";
    return "working";
  }
  return state.status === "thinking" ? "thinking" : "idle";
}
export function buildActivity(state = {}, aggregate = {}, c = {}, chat = getChatStats(state, c), now = Date.now()) {
  if (c.enabled === false) return null;
  const status = ["working", "thinking", "waiting", "idle"].includes(
    state.status,
  )
    ? state.status
    : "idle";
  const options = {
    type: 3,
    showTask: true,
    stats: "chat",
    showChurn: true,
    ...c.presence,
  };
  const privateMode = c.privacy !== "public",
    project = privateMode ? "a private project" : state.project || "Codex";
  const actions = {
    working: "Working in",
    thinking: "Thinking in",
    waiting: "Waiting on you in",
    idle: "Idle in",
  };
  const namedTitle =
    options.showTask && !privateMode
      ? conversationName(state.sessionId) ||
        (!state.sessionId || state.taskSource
          ? taskTitle(state.task)
          : undefined)
      : undefined;
  const details = namedTitle
    ? namedTitle
    : state.source === "chatgpt"
      ? "ChatGPT App · Pair Programming"
      : `${actions[status]} ${project}`;
  const tokens = chat.output,
    totals = aggregate.totals || {},
    today = aggregate.days?.[new Date().toISOString().slice(0, 10)] || {};
  const prettyTools = {
    shell: "Running bash",
    bash: "Running bash",
    exec_command: "Running bash",
    apply_patch: "Editing files",
    write_file: "Editing files",
    read_file: "Reading files",
    update_plan: "Planning",
  };
  const action =
    status === "waiting"
      ? state.waitingReason === "error"
        ? "Blocked · check the task"
        : state.waitingReason === "approval"
          ? "Needs approval"
          : state.waitingReason === "done"
            ? "Done · your move"
            : "Ready · your move"
      : status === "working"
        ? prettyTools[state.tool] || (state.tool ? `Using ${state.tool.replace(/^mcp__/, "").split("__").pop().slice(0, 32)}` : "Working")
        : status === "thinking"
          ? "Thinking"
          : "Idle";
  const parts =
    options.stats !== "cost"
      ? [`${state.model || chat.model || "Codex"} · ${tokens == null ? "usage unavailable" : compact(tokens) + " output tokens"}`, action]
      : [
          `${money(today.cost)} today`,
          `${money(totals.cost)} all-time`,
          action,
        ];
  const model = state.model || chat.model || "Codex";
  const promptsLabel = chat.prompts == null ? "" : `${compact(chat.prompts)} ${chat.prompts === 1 ? "prompt" : "prompts"}`;
  const tokensLabel = tokens == null ? "" : `${compact(tokens)} output tokens`;
  const tool = String(state.tool || chat.activeTools?.at(-1)?.name || "");
  const toolName = ({shell: "Bash", bash: "Bash", exec_command: "Bash", apply_patch: "Edit", write_file: "Write", read_file: "Read", update_plan: "Plan"})[tool] || tool.replace(/^mcp__/, "").replaceAll("__", ":");
  const activeTool = chat.activeTools?.find((t) => t.name === tool) || (chat.lastTool?.endedAt == null ? chat.lastTool : null);
  const toolMs = activeTool?.startedAt ? Math.max(0, now - activeTool.startedAt) : 0;
  const seconds = Math.floor(toolMs / 1000), minutes = seconds / 60;
  const elapsed = toolMs < 5000 ? "" : seconds < 60 ? `${seconds}s` : minutes < 10 ? `${minutes.toFixed(1)}min` : seconds < 3600 ? `${Math.round(minutes)}min` : `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`;
  // Match claude-rpc's status-specific base frames. Missing values collapse
  // rather than leaving empty separators or substituting lifetime counters.
  const target = namedTitle || (state.source === "chatgpt" ? "ChatGPT App" : project);
  const statusDetails = {
    working: `Working in ${target}`,
    thinking: `Thinking in ${target}`,
    waiting: `Waiting on you · ${target}`,
    idle: `Idle in ${target}`,
  };
  if (options.stats === "chat") {
    const currentFile = !privateMode && typeof state.file === "string"
      ? state.file.split(/[\\/]/).pop() : "";
    const frames = {
      working: [toolName, currentFile, elapsed, tokensLabel],
      thinking: [model, promptsLabel, tokensLabel],
      waiting: [model, promptsLabel],
      idle: [model, `${hoursLabel(today.activeSeconds)} today`],
    };
    parts.splice(0, parts.length, ...frames[status].filter(Boolean));
  }
  if (
    options.showChurn &&
    options.stats === "cost" &&
    (today.linesAdded || 0) + (today.linesRemoved || 0)
  )
    parts.push(`+${today.linesAdded || 0} −${today.linesRemoved || 0}`);
  const activity = {
    type: options.type,
    details: (options.stats === "chat" ? statusDetails[status] : details || `${actions[status]} ${project}`).slice(0, 128),
    state: parts.join(" · ").slice(0, 128),
    assets: {
      large_image: c.assets?.[status] || `${ASSET_BASE}/codex-pet-${status}.gif?v=calm-1`,
      large_text: (options.stats === "chat"
        ? status === "working" ? `Working with ${toolName || "Codex"}`
          : status === "thinking" ? `Reasoning with ${model}`
          : status === "waiting" ? action
          : `Idle · ${model}`
        : `${model} · ${tokens == null ? "Output usage unavailable" : `${compact(tokens)} output tokens`} · ${(totals.activeHours || 0).toFixed(1)}h on Codex · ${aggregate.streak?.current || 0} day streak`).slice(0, 128),
      small_image:
        c.assets?.badge ||
        `${ASSET_BASE}/codex-status-${statusBadgeKind({ ...state, status })}.png?v=pixel-1`,
      small_text: (options.stats === "chat" ? status === "working" && toolName ? `Using ${toolName}` : action : `${action} · ${aggregate.streak?.current || 0} day streak · ${(totals.activeHours || 0).toFixed(1)} all-time hours`).slice(0, 128),
    },
  };
  if (state.startedAt)
    activity.timestamps = { start: Math.floor(state.startedAt / 1000) };
  if (c.buttons?.length) activity.buttons = c.buttons.slice(0, 2);
  return activity;
}

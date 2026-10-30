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
const compact = (n) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);
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
export function buildActivity(state = {}, aggregate = {}, c = {}) {
  if (c.enabled === false) return null;
  const status = ["working", "thinking", "waiting", "idle"].includes(
    state.status,
  )
    ? state.status
    : "idle";
  const options = {
    type: 3,
    showTask: true,
    stats: "cost",
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
  const tokens = Number(state.tokens ?? aggregate.totals?.tokens) || 0,
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
        ? prettyTools[state.tool] || "Working"
        : status === "thinking"
          ? "Thinking"
          : "Idle";
  const parts =
    options.stats === "tokens"
      ? [`${state.model || "Codex"} · ${compact(tokens)} tokens`, action]
      : [
          `${money(today.cost)} today`,
          `${money(totals.cost)} all-time`,
          action,
        ];
  if (
    options.showChurn &&
    options.stats !== "tokens" &&
    (today.linesAdded || 0) + (today.linesRemoved || 0)
  )
    parts.push(`+${today.linesAdded || 0} −${today.linesRemoved || 0}`);
  const activity = {
    type: options.type,
    details: (details || `${actions[status]} ${project}`).slice(0, 128),
    state: parts.join(" · ").slice(0, 128),
    assets: {
      large_image: c.assets?.[status] || `codex-pet-${status}`,
      large_text:
        `${state.model || "Codex"} · ${compact(tokens)} tokens · ${status} · API cost estimate`.slice(
          0,
          128,
        ),
      small_image:
        c.assets?.badge ||
        `${ASSET_BASE}/codex-status-${statusBadgeKind({ ...state, status })}.png?v=pixel-1`,
      small_text:
        `${action} · ${aggregate.streak?.current || 0} day streak · ${(totals.activeHours || 0).toFixed(1)} all-time hours`.slice(
          0,
          128,
        ),
    },
  };
  if (state.startedAt)
    activity.timestamps = { start: Math.floor(state.startedAt / 1000) };
  if (c.buttons?.length) activity.buttons = c.buttons.slice(0, 2);
  return activity;
}

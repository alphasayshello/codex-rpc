import { animationStates } from "./store.js";
import { summarizeCommand } from "./watcher.js";
import { safeFilePath } from "./paths.js";
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
  if (state.status !== "idle" && state.visualState === "error") return "error";
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
const allowedVisualStates = new Set(animationStates);
export function getVisualState(state = {}, settings = {}, now = Date.now()) {
  const explicit = typeof state.visualState === "string" && allowedVisualStates.has(state.visualState) ? state.visualState : null;
  // Idle projections must settle old errors/successes even if a live snapshot
  // still carries the previous operation's visual hint. Other scenes are chosen
  // explicitly or by the current tool, never by rotating on elapsed time.
  if (state.status === "idle") return ["idle-cozy", "connecting", "focus"].includes(explicit) ? explicit : "idle";
  if (state.waitingReason === "error" || explicit === "error") return "error";
  if (explicit === "done" || (state.status === "waiting" && state.waitingReason === "done")) {
    const ended = state.eventTime || state.updatedAt;
    return !ended || now - ended < (settings.timing?.successMs || 15000) ? explicit === "celebrating" ? "celebrating" : "done" : "idle";
  }
  if (explicit) return explicit;
  if (state.status === "thinking") return "thinking";
  if (state.status !== "working") return "waiting";
  const tool = String(state.effectiveTool || state.tool || "").toLowerCase();
  if (state.operationKind === "editing" || /patch|edit|write_file/.test(tool)) return "patching";
  const command = summarizeCommand(state.commandSummary) || "";
  if (/^(?:(?:npm|pnpm|yarn) (?:test|run test)|pytest|cargo test|go test)$/.test(command)) return "testing";
  if (/^(?:(?:npm|pnpm|yarn) (?:build|run build)|cargo build|go build)$/.test(command)) return "building";
  if (/^(?:(?:npm|pnpm|yarn) (?:install|ci))$/.test(command)) return "installing";
  if (/^git (?:diff|show)$/.test(command) || /review/.test(tool)) return "reviewing";
  if (/^(?:rg|grep|find)$/.test(command) || /(?:^|[_:.])(?:rg|grep|glob|find)(?:$|[_:.])|search/.test(tool)) return "searching";
  if (/^(?:cat|sed)$/.test(command) || /read|list_directory|list_files/.test(tool)) return "reading";
  if (state.operationKind === "shell" || /(?:^|[_:.])(?:bash|shell|exec_command|terminal|run_command)(?:$|[_:.])/.test(tool)) return "terminal";
  return "writing";
}
const clockLabel = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
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
    stats: "telemetry",
    timer: "operation",
    showChurn: true,
    ...c.presence,
  };
  const privateMode = c.privacy !== "public",
    project = state.source === "chatgpt" && !state.project ? "ChatGPT App" : privateMode ? "a private project" : state.project || "Codex";
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
  const tool = String(state.effectiveTool || state.tool || chat.activeTools?.at(-1)?.name || "");
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
  const visual = getVisualState({ ...state, status }, c, now);
  let telemetryDetails, telemetryState;
  const operationAt = status === "thinking" ? state.thinkingStartedAt || state.operationStartedAt : state.operationStartedAt || activeTool?.startedAt;
  const operationMs = operationAt ? Math.max(0, now - operationAt) : 0;
  if (options.stats === "telemetry") {
    const files = !privateMode && Array.isArray(state.currentFiles) ? state.currentFiles.filter(safeFilePath) : [];
    const filename = !privateMode && safeFilePath(state.file) || files[0];
    const additions = Number.isFinite(state.linesAdded) ? Math.max(0, state.linesAdded) : null;
    const removals = Number.isFinite(state.linesRemoved) ? Math.max(0, state.linesRemoved) : null;
    const churn = options.showChurn && additions != null && removals != null ? ` (+${additions} / -${removals})` : "";
    const count = state.currentFileCount || files.length || (filename ? 1 : 0);
    const command = !privateMode && typeof state.commandSummary === "string" ? state.commandSummary.slice(0, 64) : "";
    const branch = !privateMode && typeof state.branch === "string" ? ` (${state.branch.slice(0, 80)})` : "";
    const coding = visual === "patching" || state.operationKind === "editing" || !!filename || /edit|write|patch/.test(tool) || (state.visualState === "writing" && !tool);
    telemetryDetails = visual === "error" ? `Blocked in ${target}`
      : visual === "done" ? `Finished in ${target}`
      : status === "thinking" ? `Pondering solution... (Elapsed: ${clockLabel(operationMs)})`
      : status === "working" && coding ? count ? `Writing code across ${count} ${count === 1 ? "file" : "files"}` : "Writing code"
      : status === "working" ? `Working in ${target}`
      : status === "idle" || visual === "idle" ? namedTitle || (state.source === "chatgpt" ? "ChatGPT App" : "Session idle") : `Waiting on you · ${target}`;
    const telemetryModel = model.slice(0, 40);
    const actionBudget = Math.max(24, 128 - telemetryModel.length - tokensLabel.length - 6);
    const fileBudget = Math.max(8, actionBudget - 8 - churn.length);
    const shownFile = filename && filename.length > fileBudget ? `…${filename.slice(-(fileBudget - 1))}` : filename;
    const idleBranch = branch.length > 24 ? branch.slice(0, 23) + "…" : branch;
    const workspaceBudget = Math.max(8, actionBudget - 8 - idleBranch.length);
    const idleProject = project.length > workspaceBudget ? project.slice(0, workspaceBudget - 1) + "…" : project;
    const liveAction = status === "idle" || visual === "idle" ? `Idle in ${idleProject}${idleBranch}` : status === "working" && coding ? `Editing ${shownFile || "files"}${churn}`
      : status === "working" && (state.operationKind === "shell" || /bash|shell|exec_command/.test(tool)) ? `Running: ${command || "shell command"}`
      : status === "working" ? (toolName ? `Using ${toolName}` : "Working")
      : visual === "error" ? "Needs attention" : "";
    telemetryState = [liveAction, telemetryModel, tokensLabel, !privateMode && options.showTask && status === "thinking" ? namedTitle : null].filter(Boolean).join(" · ");
  }
  const visualAsset = c.assets?.[visual];
  const legacyWorking = c.assets?.working;
  const automaticWorking = status === "working" && !allowedVisualStates.has(state.visualState);
  const legacyCompatible = ["writing", "patching"].includes(visual) || automaticWorking;
  const sceneAtDefault = !visualAsset || visualAsset.split("?")[0] === `${ASSET_BASE}/codex-pet-${visual}.gif`;
  const chosenAsset = legacyCompatible && legacyWorking && !legacyWorking.startsWith(ASSET_BASE) && sceneAtDefault ? legacyWorking : visualAsset;
  const activity = {
    type: options.type,
    details: (telemetryDetails || (options.stats === "chat" ? statusDetails[status] : details || `${actions[status]} ${project}`)).slice(0, 128),
    state: (telemetryState || parts.join(" · ")).slice(0, 128),
    assets: {
      large_image: chosenAsset || c.assets?.[status] || `${ASSET_BASE}/codex-pet-${visual}.gif?v=smooth-1`,
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
  const timerStart = options.timer === "operation" && ["working", "thinking"].includes(status) ? operationAt || state.startedAt : state.startedAt;
  if (timerStart) activity.timestamps = { start: Math.floor(timerStart / 1000) };
  // This card deliberately has no external buttons.
  return activity;
}

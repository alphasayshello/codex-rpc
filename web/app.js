const $ = (s) => document.querySelector(s),
  format = (n) =>
    Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n || 0);
// Appearance belongs to this browser, separate from shared RPC settings.
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};
function setTheme(theme) {
  const light = theme === "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  $("#theme-toggle").setAttribute("aria-pressed", String(light));
  $("#theme-label").textContent = light ? "Dark mode" : "Light mode";
  storage.set("codex-rpc-theme", light ? "light" : "dark");
}
setTheme(storage.get("codex-rpc-theme") || "dark");
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
function setMotion(reduced, persist = true) {
  document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  $("#motion-toggle").setAttribute("aria-pressed", String(reduced));
  $("#motion-label").textContent = reduced ? "Animate effects" : "Reduce motion";
  if (persist) storage.set("codex-rpc-motion", reduced ? "reduced" : "full");
}
setMotion(storage.get("codex-rpc-motion") ? storage.get("codex-rpc-motion") === "reduced" : motionPreference.matches, false);
$("#motion-toggle").addEventListener("click", () => { setMotion(document.documentElement.dataset.motion !== "reduced"); refresh(); });
motionPreference.addEventListener("change", () => { if (!storage.get("codex-rpc-motion")) { setMotion(motionPreference.matches, false); refresh(); } });
const mobileNavigation = matchMedia("(max-width: 760px)");
let collapsedSidebar = storage.get("codex-rpc-sidebar-collapsed") === "true", drawerOpen = false;
function updateSidebar() {
  const mobile = mobileNavigation.matches;
  const visible = mobile ? drawerOpen : !collapsedSidebar;
  document.body.classList.toggle("sidebar-collapsed", !mobile && collapsedSidebar);
  document.body.classList.toggle("sidebar-open", mobile && drawerOpen);
  $("#sidebar").inert = !visible;
  $("#main-content").inert = mobile && drawerOpen;
  $("#sidebar").setAttribute("aria-hidden", String(!visible));
  $("#sidebar-toggle").setAttribute("aria-expanded", String(visible));
  $("#sidebar-overlay").hidden = !(mobile && drawerOpen);
  $("#sidebar-close").hidden = !mobile;
  $(".tabs").setAttribute("aria-orientation", mobile ? "horizontal" : "vertical");
}
function closeDrawer(restoreFocus = true) {
  drawerOpen = false;
  updateSidebar();
  if (restoreFocus) $("#sidebar-toggle").focus();
}
$("#sidebar-toggle").addEventListener("click", () => {
  if (mobileNavigation.matches) {
    drawerOpen = !drawerOpen;
    updateSidebar();
    if (drawerOpen) $("#sidebar-close").focus();
  } else {
    collapsedSidebar = !collapsedSidebar;
    storage.set("codex-rpc-sidebar-collapsed", String(collapsedSidebar));
    updateSidebar();
  }
});
$("#sidebar-close").addEventListener("click", () => closeDrawer());
$("#sidebar-overlay").addEventListener("click", () => closeDrawer());
mobileNavigation.addEventListener("change", () => { drawerOpen = false; updateSidebar(); });
updateSidebar();
const navigationLinks = [...document.querySelectorAll("nav a")];
function selectNavigation(hash) {
  for (const link of navigationLinks) {
    const active = link.getAttribute("href") === hash;
    link.classList.toggle("selected", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
for (const link of navigationLinks) link.addEventListener("click", () => {
  selectNavigation(link.hash);
  if (mobileNavigation.matches) {
    closeDrawer(false);
    const target = document.querySelector(link.hash);
    target?.setAttribute("tabindex", "-1");
    target?.focus({ preventScroll: true });
  }
});
window.addEventListener("hashchange", () => selectNavigation(location.hash || "#overview"));
selectNavigation(location.hash || "#overview");
document.addEventListener("keydown", (event) => {
  if (!mobileNavigation.matches || !drawerOpen) return;
  if (event.key === "Escape") { event.preventDefault(); closeDrawer(); }
  if (event.key === "Tab") {
    const items = [...$("#sidebar").querySelectorAll("a[href], button:not([hidden]):not([disabled])")].filter((node) => node.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
let cfg,
  token,
  tab = "Presence",
  refreshing = false,
  refreshPending = false;
const categories = [
  "Presence",
  "Discord",
  "Codex Pet Assets",
  "Timing",
  "Daemon Controls",
  "Privacy",
  "Stats",
];
async function api(url, body) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Codex-Rpc-Token": token,
          },
          body: JSON.stringify(body),
        },
  );
  const result = await r.json();
  if (!r.ok) throw Error(result.error || `HTTP ${r.status}`);
  return result;
}
function ranks(id, values) {
  const target = $(id);
  target.replaceChildren();
  const list = Object.entries(values || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (!list.length) {
    target.textContent = "Your next session writes the first line.";
    target.classList.add("muted");
    return;
  }
  target.classList.remove("muted");
  for (const [name, n] of list) {
    const row = document.createElement("div");
    row.className = "rank-row";
    const labels = document.createElement("div"),
      label = document.createElement("span"),
      count = document.createElement("span");
    label.textContent = name;
    count.textContent = format(n);
    labels.append(label, count);
    const track = document.createElement("div");
    track.className = "track";
    const fill = document.createElement("b");
    fill.style.width = `${(n / list[0][1]) * 100}%`;
    track.append(fill);
    row.append(labels, track);
    target.append(row);
  }
}
function heatmap(a) {
  const grid = $("#heatmap");
  grid.replaceChildren();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364 - start.getUTCDay());
  const max = Math.max(
    1,
    ...Object.values(a.days || {}).map((s) => s.tokens || s.prompts || 0),
  );
  let active = 0;
  for (let i = 0; i < 371; i++) {
    const d = new Date(+start + i * 86400000),
      day = d.toISOString().slice(0, 10),
      stats = a.days?.[day] || {},
      value = stats.tokens || stats.prompts || 0;
    const b = document.createElement("button");
    if (d > today) {
      b.style.visibility = "hidden";
      b.tabIndex = -1;
    } else {
      b.title = `${day}: ${format(stats.tokens)} tokens, ${stats.prompts || 0} prompts`;
      b.setAttribute("aria-label", b.title);
      b.style.background = `var(--heat-${value ? Math.max(1, Math.ceil((value / max) * 4)) : 0})`;
      b.addEventListener("click", () => {
        $("#day-detail").textContent =
          `${day} · ${format(stats.tokens)} tokens · ${stats.toolCalls || 0} tools · $${(stats.cost || 0).toFixed(4)}`;
      });
    }
    if (value) active++;
    grid.append(b);
  }
  $("#active-days").textContent = `${active} active days`;
  const months = $("#months");
  months.replaceChildren();
  for (let i = 0; i < 12; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    const label = document.createElement("span");
    label.textContent = d.toLocaleString("en", {
      month: "short",
      timeZone: "UTC",
    });
    months.append(label);
  }
}
function renderChat(chat = {}) {
  const known = (n) => typeof n === "number" && Number.isFinite(n);
  const metric = (n) => known(n) ? format(n) : "—";
  $("#chat-heading").textContent = chat.title || (chat.id ? "Current conversation" : "Waiting for a conversation");
  $("#chat-meta").textContent = chat.id
    ? [chat.source === "chatgpt" ? "ChatGPT Desktop" : "Codex", chat.model || "Model not reported", "This conversation only"].join(" · ")
    : "Your current conversation, independent of the time range above.";
  $("#chat-tokens").textContent = metric(chat.output);
  for (const name of ["input", "output", "reasoning", "cached", "prompts"])
    $(`#chat-${name}`).textContent = metric(chat[name]);
  $("#chat-tools-count").textContent = metric(chat.toolCalls);
  $("#chat-time").textContent = known(chat.activeHours)
    ? chat.activeHours < 1 ? `${Math.round(chat.activeHours * 60)} min` : `${chat.activeHours.toFixed(1)} h`
    : "—";
  $("#chat-churn").textContent = known(chat.linesAdded) && known(chat.linesRemoved)
    ? `+${format(chat.linesAdded)} / −${format(chat.linesRemoved)}` : "—";
  $("#chat-cost").textContent = known(chat.cost)
    ? `$${chat.cost.toFixed(chat.cost < 1 ? 4 : 2)}${chat.unknownCostTokens ? " + unpriced" : ""}` : "—";
  function meter(prefix, percent, label) {
    $(`#chat-${prefix}-label`).textContent = label;
    $(`#chat-${prefix}-fill`).style.width = `${known(percent) ? Math.max(0, Math.min(100, percent)) : 0}%`;
  }
  meter("cache", chat.cachePercent, known(chat.cachePercent) ? `${chat.cachePercent.toFixed(1)}%` : "Not reported");
  meter("context", chat.contextPercent, known(chat.lastRequestTokens) && known(chat.contextWindow)
    ? `${format(chat.lastRequestTokens)} / ${format(chat.contextWindow)}${known(chat.contextPercent) ? ` · ${chat.contextPercent.toFixed(1)}%` : ""}`
    : "Not reported");
  function tools(id, list, active) {
    const target = $(id);
    target.replaceChildren();
    if (!list?.length) {
      target.textContent = active ? "No tools running" : "No tool activity recorded";
      return;
    }
    for (const tool of list.slice(-8)) {
      const chip = document.createElement("span");
      chip.className = `tool-chip${active ? " running" : ""}`;
      const name = typeof tool === "string" ? tool : tool.name || "tool";
      chip.textContent = name;
      if (!active && known(tool.durationMs)) {
        const duration = document.createElement("small");
        duration.textContent = tool.durationMs < 1000 ? `${Math.round(tool.durationMs)}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`;
        chip.append(duration);
      }
      target.append(chip);
    }
  }
  tools("#chat-active-tools", chat.activeTools, true);
  tools("#chat-recent-tools", chat.recentTools, false);
  $("#chat-note").textContent = [
    "Recorded locally · reasoning is included in output · API equivalent is an estimate.",
    chat.output == null ? "Output token usage has not been reported for this chat." : "",
    chat.unknownCostTokens ? `${format(chat.unknownCostTokens)} tokens have no known model price.` : "",
  ].filter(Boolean).join(" ");
}
let chatChoices = [], pinnedChat = null, draftChat = null, pinBusy = false;
let timelineData = { rows: [] };
const chatKey = (chat) => chat?.id ? JSON.stringify([chat.source || "codex", chat.id]) : "";
function updatePinControls() {
  const value = $("#chat-picker").value;
  $("#pin-chat").disabled = pinBusy || !value || value === chatKey(pinnedChat);
  $("#unpin-chat").disabled = pinBusy || !pinnedChat;
  $("#chat-picker").disabled = pinBusy;
}
function renderChats(data = {}) {
  chatChoices = data.chats || [];
  pinnedChat = data.pinned || null;
  const picker = $("#chat-picker");
  const selection = draftChat ?? chatKey(pinnedChat);
  picker.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "Automatic · follow latest conversation";
  picker.append(automatic);
  for (const chat of chatChoices) {
    const option = document.createElement("option");
    option.value = chatKey(chat);
    option.textContent = [chat.title || "Untitled conversation", chat.source === "chatgpt" ? "ChatGPT" : "Codex", chat.status || "idle", chat.current ? "current" : ""].filter(Boolean).join(" · ");
    picker.append(option);
  }
  // Keep an unsaved choice through SSE refreshes; selecting alone never pins.
  picker.value = selection;
  if (picker.selectedIndex < 0) { picker.value = ""; draftChat = null; }
  const pinTitle = chatChoices.find((chat) => chatKey(chat) === chatKey(pinnedChat))?.title || "Selected conversation";
  $("#chat-pin-status").textContent = pinnedChat
    ? `Pinned to Discord: ${pinTitle}. Follow latest to return to automatic selection.`
    : "Following the latest conversation automatically. Choose a conversation and click Pin to Discord to keep it selected.";
  if (draftChat != null && draftChat !== chatKey(pinnedChat))
    $("#chat-pin-status").textContent += draftChat ? " New choice is not pinned yet." : " Click Follow latest to clear the pin.";
  updatePinControls();
}
function renderTimeline(data = {}) {
  timelineData = data;
  const target = $("#tool-timeline");
  target.replaceChildren();
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const running = rows.filter((row) => row.status === "running").length;
  $("#timeline-summary").textContent = running ? `${running} running · ${rows.length} recorded` : `${rows.length} recorded`;
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "timeline-empty";
    empty.textContent = data.sessionId ? "No tools recorded for this conversation yet." : "Start or pin a conversation to see its tools here.";
    target.append(empty);
    return;
  }
  for (const row of rows.slice().reverse()) {
    const item = document.createElement("li");
    item.className = "timeline-row";
    const details = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = row.name || "Tool";
    details.append(name);
    if (row.file) {
      const file = document.createElement("span");
      file.className = "timeline-file";
      file.textContent = row.file;
      details.append(file);
    }
    const metadata = document.createElement("div");
    metadata.className = "timeline-metadata";
    const status = document.createElement("span");
    const kind = ["running", "completed", "failed"].includes(row.status) ? row.status : "unknown";
    status.className = `timeline-status ${kind}`;
    status.textContent = kind === "unknown" ? "Status unknown" : kind[0].toUpperCase() + kind.slice(1);
    metadata.append(status);
    const ms = kind === "running" && Number.isFinite(row.startedAt) && row.startedAt > 0
      ? Math.max(0, Date.now() - row.startedAt) : row.durationMs;
    const duration = document.createElement("span");
    duration.className = "timeline-duration";
    duration.textContent = typeof ms === "number" && Number.isFinite(ms)
      ? ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`
      : "Duration unavailable";
    metadata.append(duration);
    if (Number.isInteger(row.exitCode)) {
      const exit = document.createElement("span");
      exit.className = "timeline-exit";
      exit.textContent = `exit ${row.exitCode}`;
      metadata.append(exit);
    }
    item.append(details, metadata);
    target.append(item);
  }
}
$("#chat-picker").addEventListener("change", () => {
  draftChat = $("#chat-picker").value;
  renderChats({ chats: chatChoices, pinned: pinnedChat });
});
async function changePin(selection) {
  if (pinBusy) return;
  pinBusy = true;
  updatePinControls();
  try {
    await api("/api/pin", selection);
    draftChat = null;
    await refresh();
  } catch (error) {
    $("#chat-pin-status").textContent = `Could not change Discord selection: ${error.message}`;
  } finally {
    pinBusy = false;
    updatePinControls();
  }
}
$("#pin-chat").addEventListener("click", () => {
  const chat = chatChoices.find((choice) => chatKey(choice) === $("#chat-picker").value);
  if (chat) changePin({ id: chat.id, source: chat.source });
});
$("#unpin-chat").addEventListener("click", () => changePin({ id: null }));
setInterval(() => {
  if (timelineData.rows?.some((row) => row.status === "running")) renderTimeline(timelineData);
}, 1000);
function renderRecaps(data = {}) {
  const target = $("#turn-recaps");
  const rows = data.rows || [];
  const signature = JSON.stringify([data.sessionId, rows]);
  if (target.dataset.signature === signature) return;
  target.dataset.signature = signature;
  target.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li"); empty.className = "timeline-empty";
    empty.textContent = "Finish a turn to see its recap. Earlier turns may not have recorded baselines.";
    target.append(empty); return;
  }
  for (const row of rows.slice(0, 20)) {
    const item = document.createElement("li"); item.className = "recap-row";
    const title = document.createElement("strong");
    title.textContent = row.outputTokens == null ? "Output not reported" : `${format(row.outputTokens)} output tokens`;
    const details = document.createElement("span");
    details.textContent = [row.toolCalls == null ? null : `${row.toolCalls} ${row.toolCalls === 1 ? "tool" : "tools"}`, row.elapsedMs == null ? null : `${(row.elapsedMs / 1000).toFixed(1)}s`, row.model].filter(Boolean).join(" · ");
    const outcome = document.createElement("span"); outcome.className = `timeline-status ${row.outcome === "failed" ? "failed" : "completed"}`;
    outcome.textContent = row.outcome || "unknown";
    const time = document.createElement("time");
    if (Number.isFinite(row.endedAt)) { time.dateTime = new Date(row.endedAt).toISOString(); time.textContent = new Date(row.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    item.append(title, details, outcome, time); target.append(item);
  }
}
async function refresh() {
  if (refreshing) { refreshPending = true; return; }
  refreshing = true;
  try {
    const [s, a, year, activity, chat, chats, timeline, recaps] = await Promise.all([
      api("/api/state"),
      api("/api/aggregate?range=" + $("#range").value),
      api("/api/aggregate?range=1y"),
      api("/api/presence"),
      api("/api/chat"),
      api("/api/chats"),
      api("/api/timeline"),
      api("/api/recaps"),
    ]);
    renderChat(chat);
    renderChats(chats);
    renderTimeline(timeline);
    renderRecaps(recaps);
    const t = a.totals || {},
      state = ["working", "thinking", "waiting", "idle"].includes(s.status)
        ? s.status
        : "idle";
    const visual = ["idle", "thinking", "writing", "patching", "error", "done", "waiting", "working"].includes(s.visualState) ? s.visualState : state;
    $(".live").dataset.state = visual;
    const bundled =
      "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/";
    const configuredPet = activity?.assets?.large_image;
    const petURL =
      configuredPet?.startsWith("https://") &&
      !configuredPet.startsWith(bundled)
        ? configuredPet
        : `/assets/pet/codex-pet-${visual}.${document.documentElement.dataset.motion === "reduced" ? "svg" : "gif"}`;
    if ($("#pet").getAttribute("src") !== petURL) $("#pet").src = petURL;
    const configuredBadge = activity?.assets?.small_image;
    const badgeURL =
      configuredBadge?.startsWith("https://") &&
      !configuredBadge.startsWith(bundled)
        ? configuredBadge
        : `/assets/pet/codex-status-${s.badgeKind || state}.${document.documentElement.dataset.motion === "reduced" ? "png" : "gif"}`;
    if ($("#status-badge").getAttribute("src") !== badgeURL)
      $("#status-badge").src = badgeURL;
    $("#activity-type").textContent =
      ((activity?.type ?? cfg.presence.type) === 3 ? "WATCHING" : "PLAYING") +
      " CODEX RPC";
    $("#pet").alt = `Codex Pet ${visual}`;
    $("#live-status").textContent = s.enabled ? state : "paused";
    $("#live-action").textContent = activity?.details || "Presence paused";
    $("#live-model").textContent =
      activity?.state || "Resume when you are ready.";
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - (s.startedAt || Date.now())) / 1000),
    );
    $("#live-source").textContent =
      `${s.source === "chatgpt" ? "ChatGPT Desktop" : "Codex CLI"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed`;
    $("#daemon").textContent =
      `Daemon ${s.daemon?.pid ? "running" : "offline"} · Discord ${s.daemon?.connected ? "connected" : "offline"}`;
    $("#toggle-presence").textContent = s.enabled
      ? "Pause presence ⏸"
      : "Resume presence ▷";
    $("#toggle-presence").dataset.enabled = String(s.enabled);
    $("#tokens").textContent = format(t.tokens);
    $("#hours").textContent = `${(t.activeHours || 0).toFixed(1)} h`;
    $("#sessions").textContent = t.sessions || 0;
    $("#streak").textContent = `${a.streak?.current || 0} days`;
    $("#best-streak").textContent =
      `Longest streak · ${a.streak?.longest || 0} days`;
    $("#cost").textContent = `$${(t.cost || 0).toFixed(2)}`;
    $("#unpriced").textContent = t.unknownCostTokens
      ? `${format(t.unknownCostTokens)} tokens have no known price.`
      : "USD · recorded usage only";
    const sources = t.sources || {},
      total = (sources.codex || 0) + (sources.chatgpt || 0);
    $("#sources").textContent =
      t.sourceHours && (t.sourceHours.codex || t.sourceHours.chatgpt)
        ? `Codex ${(t.sourceHours.codex || 0).toFixed(1)}h · ChatGPT ${(t.sourceHours.chatgpt || 0).toFixed(1)}h observed focus`
        : `Codex ${total ? Math.round(((sources.codex || 0) / total) * 100) : 0}% · ChatGPT ${total ? Math.round(((sources.chatgpt || 0) / total) * 100) : 0}% of recorded actions`;
    ranks("#tools", t.tools);
    ranks("#languages", t.languages);
    heatmap(year);
    const histogram = $("#histogram");
    histogram.replaceChildren();
    const hours = t.hours || Array(24).fill(0),
      max = Math.max(1, ...hours);
    hours.forEach((n, i) => {
      const bar = document.createElement("div"),
        fill = document.createElement("b"),
        label = document.createElement("span");
      fill.style.height = `${Math.max(2, (n / max) * 85)}px`;
      bar.title = `${i}:00 UTC · ${n} actions`;
      label.textContent = i % 3 === 0 ? String(i).padStart(2, "0") : "";
      bar.append(fill, label);
      histogram.append(bar);
    });
  } catch (e) {
    $("#connection").textContent = e.message;
  } finally {
    refreshing = false;
    if (refreshPending) {
      refreshPending = false;
      queueMicrotask(refresh);
    }
  }
}
function field(label, key, type = "text", hint = "") {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  if (hint) {
    const small = document.createElement("small");
    small.textContent = hint;
    caption.append(small);
  }
  let input;
  if (type === "textarea") {
    input = document.createElement("textarea");
  } else if (type === "activityType" || type === "statsStyle" || type === "timerStyle") {
    input = document.createElement("select");
    const choices =
      type === "timerStyle" ? [["operation", "Current operation"], ["session", "Whole session"]] : type === "activityType"
        ? [
            [3, "Watching"],
            [0, "Playing"],
          ]
        : [
            ["telemetry", "Live files, diffs and operation timers (default)"],
            ["chat", "Claude-style · chat output tokens"],
            ["cost", "Today / all-time cost"],
            ["tokens", "Model / output tokens"],
          ];
    for (const [value, label] of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      input.append(option);
    }
  } else if (type === "privacy") {
    input = document.createElement("select");
    for (const p of ["private", "public"]) {
      const o = document.createElement("option");
      o.value = p;
      o.textContent = p;
      input.append(o);
    }
  } else {
    input = document.createElement("input");
    input.type = type;
  }
  const keys = key.split(".");
  let value = cfg;
  for (const k of keys) value = value?.[k];
  input.dataset.key = key;
  if (type === "checkbox") input.checked = !!value;
  else
    input.value =
      type === "textarea" ? JSON.stringify(value, null, 2) : (value ?? "");
  input.addEventListener("change", () => {
    try {
      let target = cfg;
      for (const k of keys.slice(0, -1)) target = target[k];
      target[keys.at(-1)] =
        type === "checkbox"
          ? input.checked
          : type === "number" || type === "activityType"
            ? Number(input.value)
            : type === "textarea"
              ? JSON.parse(input.value)
              : input.value;
      input.setCustomValidity("");
      $("#save-status").textContent = "Unsaved changes";
    } catch {
      input.setCustomValidity("Enter valid JSON for buttons.");
      $("#save-status").textContent = "Enter valid JSON for buttons.";
    }
  });
  wrap.append(caption, input);
  return wrap;
}
function settings() {
  const tabs = $(".tabs");
  tabs.replaceChildren();
  tabs.setAttribute("aria-orientation", mobileNavigation.matches ? "horizontal" : "vertical");
  function activate(name) {
    tab = name;
    settings();
    document.getElementById(`settings-tab-${categories.indexOf(name)}`).focus();
  }
  for (const [index, name] of categories.entries()) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "tab";
    b.id = `settings-tab-${index}`;
    b.tabIndex = name === tab ? 0 : -1;
    b.setAttribute("aria-controls", "settings-content");
    b.setAttribute("aria-selected", name === tab);
    b.textContent = name;
    b.addEventListener("click", () => activate(name));
    b.addEventListener("keydown", (event) => {
      const previous = mobileNavigation.matches ? "ArrowLeft" : "ArrowUp";
      const next = mobileNavigation.matches ? "ArrowRight" : "ArrowDown";
      let selected;
      if (event.key === previous) selected = (index + categories.length - 1) % categories.length;
      if (event.key === next) selected = (index + 1) % categories.length;
      if (event.key === "Home") selected = 0;
      if (event.key === "End") selected = categories.length - 1;
      if (selected !== undefined) { event.preventDefault(); activate(categories[selected]); }
    });
    tabs.append(b);
  }
  const content = $("#settings-content");
  content.replaceChildren();
  content.setAttribute("role", "tabpanel");
  content.setAttribute("aria-labelledby", `settings-tab-${categories.indexOf(tab)}`);
  const intro = document.createElement("p");
  const descriptions = {
    Presence: "The card on your profile, with as much detail as you choose.",
    Discord:
      "Use an Application ID from the Discord Developer Portal. Discord Desktop must be running.",
    "Codex Pet Assets":
      "Host the bundled animated GIFs over HTTPS, or upload still assets to your Discord application. Animation support depends on Discord.",
    Timing:
      "Intervals are milliseconds. Presence updates are limited to at least 15 seconds.",
    "Daemon Controls":
      "Manage the local background process. Pausing also stops new event collection.",
    Privacy:
      "Private mode redacts task titles and project names from the live state and file paths from aggregate output. Existing scanner cache remains local.",
    Stats:
      "Lifetime totals come from local Codex JSONL logs. ChatGPT process detection cannot reveal tokens.",
  };
  intro.textContent = descriptions[tab];
  content.append(intro);
  const defs = {
    Presence: [
      ["Presence enabled", "enabled", "checkbox"],
      ["Activity type", "presence.type", "activityType"],
      ["Stats line", "presence.stats", "statsStyle"],
      ["Elapsed timer", "presence.timer", "timerStyle"],
      [
        "Show conversation name",
        "presence.showTask",
        "checkbox",
        "Conversation names are shared only in public privacy mode.",
      ],
      ["Show lines added / removed", "presence.showChurn", "checkbox"],

    ],
    Discord: [["Application ID", "clientId", "text"]],
    "Codex Pet Assets": [
      ["Writing GIF URL / key", "assets.writing"],
      ["Patching GIF URL / key", "assets.patching"],
      ["Error GIF URL / key", "assets.error"],
      ["Success GIF URL / key", "assets.done"],
      ["Legacy working GIF URL / key", "assets.working"],
      ["Thinking GIF URL / key", "assets.thinking"],
      ["Waiting GIF URL / key", "assets.waiting"],
      ["Idle GIF URL / key", "assets.idle"],
      [
        "Status badge override",
        "assets.badge",
        "text",
        "Leave blank for automatic working / thinking / done / idle icons.",
      ],
    ],
    Timing: Object.keys(cfg.timing).map((k) => [k, "timing." + k, "number"]),
    Privacy: [
      ["Sharing mode", "privacy", "privacy"],
      ["Detect ChatGPT Desktop", "chatgpt.enabled", "checkbox"],
    ],
    Stats: [["Scan local session logs", "stats.enabled", "checkbox"]],
  };
  for (const def of defs[tab] || []) content.append(field(...def));
  if (tab === "Daemon Controls") {
    for (const action of ["start", "pause", "resume", "restart", "stop"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "control-button";
      b.textContent = action;
      b.addEventListener("click", async () => {
        try {
          await api("/api/control", { action });
          cfg = await api("/api/config");
          $("#save-status").textContent = `${action} complete`;
          await refresh();
        } catch (e) {
          $("#save-status").textContent = e.message;
        }
      });
      content.append(b);
    }
  }
  if (tab === "Codex Pet Assets") {
    const gallery = document.createElement("img");
    gallery.src = "/assets/pet/status-badges.svg";
    gallery.alt =
      "Ten pixel status badges: command, thinking, done, idle, approval, editing, reading, review, ready, error";
    gallery.className = "badge-gallery";
    content.append(gallery);
    const preview = document.createElement("a");
    preview.href = "/assets/pet/animation-gallery.html";
    preview.target = "_blank"; preview.rel = "noopener";
    preview.className = "text-button"; preview.textContent = "Preview animated pets and pixel badges ↗";
    content.append(preview);
  }
  if (tab === "Stats") {
    const link = document.createElement("a");
    link.href = "/cards/stats.svg";
    link.textContent = "Open live SVG stats card ↗";
    link.className = "text-button";
    content.append(link);
  }
}
$("#range").addEventListener("change", refresh);
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    cfg = await api("/api/config", cfg);
    $("#save-status").textContent = "Saved on this device.";
    await refresh();
  } catch (e) {
    $("#save-status").textContent = e.message;
  }
});
$("#toggle-presence").addEventListener("click", async () => {
  try {
    await api("/api/control", {
      action:
        $("#toggle-presence").dataset.enabled === "true" ? "pause" : "resume",
    });
    cfg = await api("/api/config");
    settings();
    await refresh();
  } catch (e) {
    $("#connection").textContent = e.message;
  }
});
try {
  ({ token } = await api("/api/session"));
  cfg = await api("/api/config");
  settings();
  await refresh();
  const stream = new EventSource("/events");
  stream.onopen = () => {
    $("#connection").textContent = "Live on this device";
    $("#stream-dot").style.background = "var(--success, #4daa77)";
  };
  stream.onerror = () => {
    $("#connection").textContent = "Reconnecting…";
    $("#stream-dot").style.background = "var(--warning, #c5975d)";
  };
  stream.addEventListener("update", refresh);
} catch (e) {
  $("#connection").textContent = e.message;
}

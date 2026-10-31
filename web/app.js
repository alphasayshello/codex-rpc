const $ = (s) => document.querySelector(s),
  format = (n) =>
    Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n || 0);
let viewedChat = null;
// Keep GIF decoders idle when their view is offscreen or the page is hidden.
const animatedPictures = new Set();
const visiblePictures = new WeakMap();
function updatePicture(picture) {
  const obscured = $("#settings-dialog")?.open && !picture.closest("#settings-dialog");
  const still = document.hidden || obscured || !!picture.closest("[inert]") || document.documentElement.dataset.motion === "reduced" || visiblePictures.get(picture) === false;
  const src = still ? picture.dataset.still : picture.dataset.animated;
  if (src && picture.getAttribute("src") !== src) picture.src = src;
}
const pictureObserver = new IntersectionObserver(entries => {
  for (const entry of entries) { visiblePictures.set(entry.target, entry.isIntersecting); updatePicture(entry.target); }
});
function animatePicture(picture, animated, still = animated) {
  picture.dataset.animated = animated;
  picture.dataset.still = still;
  if (!animatedPictures.has(picture)) { animatedPictures.add(picture); pictureObserver.observe(picture); }
  updatePicture(picture);
}
function updatePictures() {
  for (const picture of animatedPictures) {
    if (!picture.isConnected) { pictureObserver.unobserve(picture); animatedPictures.delete(picture); }
    else updatePicture(picture);
  }
}
function studioAppearance() {
  const frame = $("#studio-frame");
  if (frame?.getAttribute("src")) frame.contentWindow?.postMessage({ type: "codex-rpc:appearance", theme: document.documentElement.dataset.theme, motion: document.documentElement.dataset.motion, active: document.body.dataset.page === "studio" && !document.hidden && !$("#settings-dialog")?.open && !$("#main-content").inert }, location.origin);
}
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
  studioAppearance();
}
setTheme(storage.get("codex-rpc-theme") || "dark");
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
function setMotion(reduced, persist = true) {
  document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  $("#motion-toggle").setAttribute("aria-pressed", String(reduced));
  $("#motion-label").textContent = reduced ? "Animate effects" : "Reduce motion";
  if (persist) storage.set("codex-rpc-motion", reduced ? "reduced" : "full");
  updatePictures();
  studioAppearance();
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
  updatePictures(); studioAppearance();
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
let currentPage = "overview", settingsReturnFocus = null;
const pageCopy = {
  overview: ["Overview", "Your workspace", "Your live Discord card and recent conversations."],
  activity: ["Analytics", "Your activity", "Explore usage, tools, and your coding rhythm."],
  chat: ["Conversations", "Inside this chat", "Output usage, tool activity, and turn recaps. Browsing never changes your Discord pin."],
  studio: ["Pet Studio", "Your companions", "Explore animations, create a pet, or bring your own character."],
};
function selectNavigation(hash) {
  const target = hash.slice(1);
  if (target === "settings") { openSettings(); return; }
  if ($("#settings-dialog").open) closeSettings();
  if (target === "overview" && viewedChat) {
    viewedChat = null; draftChat = null;
    renderChats({ chats: chatChoices, pinned: pinnedChat });
    refresh();
  }
  currentPage = Object.hasOwn(pageCopy, target) ? target : "overview";
  document.body.dataset.page = currentPage;
  for (const section of document.querySelectorAll(".workspace-page")) section.hidden = section.dataset.page !== currentPage;
  $("#chat").hidden = !["overview", "chat"].includes(currentPage);
  const [eyebrow, title, subtitle] = pageCopy[currentPage];
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  for (const link of navigationLinks) {
    const active = link.hash === `#${currentPage}`;
    link.classList.toggle("selected", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (currentPage === "studio") {
    const frame = $("#studio-frame");
    if (!frame.getAttribute("src")) frame.src = frame.dataset.src;
    studioAppearance();
  }
  updatePictures();
  studioAppearance();
}
function navigate(page) {
  if (mobileNavigation.matches) closeDrawer(false);
  if (location.hash !== `#${page}`) location.hash = page;
  else selectNavigation(`#${page}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}
function openSettings() {
  const returnFocus = mobileNavigation.matches ? $("#sidebar-toggle") : document.activeElement;
  if (mobileNavigation.matches) closeDrawer(false);
  const dialog = $("#settings-dialog");
  if (!dialog.open) { settingsReturnFocus = returnFocus; dialog.showModal(); }
  $("#close-settings").focus();
  queueMicrotask(async () => {
    if (!cfg || settingsDirty) return;
    try {
      const latest = await api("/api/config");
      if (!settingsDirty && dialog.open && JSON.stringify(latest) !== JSON.stringify(cfg)) {
        const focusedId = document.activeElement.id;
        cfg = latest; settings();
        if (focusedId) document.getElementById(focusedId)?.focus();
      }
    }
    catch (error) { $("#save-status").textContent = error.message; }
  });
  updatePictures(); studioAppearance();
}
function closeSettings() { $("#settings-dialog").close(); }
$("#open-settings").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", closeSettings);
$("#settings-dialog").addEventListener("click", event => { if (event.target === $("#settings-dialog")) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSettings(); } });
$("#settings-dialog").addEventListener("close", () => {
  if (location.hash === "#settings") history.replaceState(null, "", `#${currentPage}`);
  settingsReturnFocus?.focus(); updatePictures(); studioAppearance();
});
$("#studio-frame").addEventListener("load", studioAppearance);
for (const link of navigationLinks) link.addEventListener("click", event => { event.preventDefault(); navigate(link.hash.slice(1)); });
window.addEventListener("hashchange", () => selectNavigation(location.hash || "#overview"));
selectNavigation(location.hash || "#overview");
document.addEventListener("keydown", (event) => {
  if (!mobileNavigation.matches || !drawerOpen) return;
  if (event.key === "Escape") { event.preventDefault(); closeDrawer(); }
  if (event.key === "Tab") {
    const items = [...$("#sidebar").querySelectorAll("a[href], button:not([hidden]):not([disabled]), input:not([disabled])")].filter((node) => node.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
let animationData = { animations: [], baseURL: "" };
let petData = { pets: [], selected: "codex" }, settingsDirty = false;
let cfg,
  token,
  tab = "Presence",
  refreshing = false,
  refreshPending = false;
let refreshTimer = null, hiddenRefresh = false, liveState = {}, liveStream = null;
const renderedVersions = new Map();
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
function unchanged(node, value) {
  const signature = JSON.stringify(value);
  if (node.dataset.renderSignature === signature) return true;
  node.dataset.renderSignature = signature;
  return false;
}
function ranks(id, values) {
  const target = $(id);
  if (unchanged(target, values || {})) return;
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
  if (unchanged(grid, [new Date().toISOString().slice(0, 10), a.days])) return;
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
    if (unchanged(target, list || [])) return;
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
  const selection = draftChat ?? (chatKey(viewedChat) || chatKey(pinnedChat));
  if (!unchanged(picker, chatChoices.map(chat => [chatKey(chat), chat.title, chat.status, chat.current]))) {
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
  }
  renderSidebarChats();
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
  const target = $("#tool-timeline");
  if (unchanged(target, data)) return;
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
    if (kind === "running" && Number.isFinite(row.startedAt)) duration.dataset.startedAt = row.startedAt;
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
    viewedChat = null;
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
function renderElapsed() {
  const seconds = Math.max(0, Math.floor((Date.now() - (liveState.startedAt || Date.now())) / 1000));
  $("#live-source").textContent = `${liveState.source === "chatgpt" ? "ChatGPT Desktop" : "Codex CLI"} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed`;
}
function elapsed(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`;
}
setInterval(() => {
  if (document.hidden || !["overview", "chat"].includes(currentPage)) return;
  if (currentPage === "overview") renderElapsed();
  for (const duration of document.querySelectorAll(".timeline-duration[data-started-at]")) duration.textContent = elapsed(Math.max(0, Date.now() - Number(duration.dataset.startedAt)));
}, 1000);
function renderSidebarChats() {
  const list = $("#sidebar-chats"), search = $("#chat-search").value.trim().toLowerCase();
  const choices = chatChoices.filter(chat => [chat.title, chat.model, chat.source === "chatgpt" ? "ChatGPT" : "Codex"].join(" ").toLowerCase().includes(search));
  const selected = chatKey(viewedChat);
  const grouped = choices.map(chat => {
    const age = chat.lastActivityAt ? (Date.now() - chat.lastActivityAt) / 86400000 : Infinity;
    return { chat, group: age < 1 ? "Today" : age < 7 ? "Previous 7 days" : age < 30 ? "Previous 30 days" : "Earlier" };
  });
  const projection = grouped.map(({ chat, group }) => [chatKey(chat), chat.title, chat.output, chat.current, chat.pinned, group]);
  if (unchanged(list, [projection, selected])) return;
  $("#chat-search-empty").hidden = choices.length > 0;
  $("#chat-search-empty").textContent = search ? "No matching conversations." : "Your conversations will appear here.";
  const existing = new Map([...list.children].map(item => [item.dataset.rowKey, item]));
  const ordered = [];
  let group = "";
  for (const entry of grouped) {
    const { chat } = entry;
    if (entry.group !== group) {
      group = entry.group;
      const key = `group:${group}`, heading = existing.get(key) || document.createElement("li");
      heading.dataset.rowKey = key; heading.className = "chat-nav-group"; heading.textContent = group; ordered.push(heading);
    }
    const key = chatKey(chat), item = existing.get(key) || document.createElement("li");
    item.dataset.rowKey = key;
    let button = item.querySelector("button");
    if (!button) {
      button = document.createElement("button"); button.type = "button"; button.className = "chat-nav-item"; button.dataset.chatKey = key;
      const title = document.createElement("span"), meta = document.createElement("span"); title.className = "chat-nav-title"; meta.className = "chat-nav-meta";
      button.append(title, meta); item.append(button);
      button.addEventListener("click", () => { viewedChat = { id: chat.id, source: chat.source }; draftChat = key; navigate("chat"); renderChats({ chats: chatChoices, pinned: pinnedChat }); refresh(); });
    }
    button.classList.toggle("selected", key === selected);
    if (key === selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    const title = button.querySelector(".chat-nav-title"), meta = button.querySelector(".chat-nav-meta");
    const titleText = chat.title || "Untitled conversation", metaText = [chat.source === "chatgpt" ? "ChatGPT" : "Codex", chat.output == null ? null : `${format(chat.output)} output`, chat.pinned ? "Pinned to Discord" : chat.current ? "Latest" : null].filter(Boolean).join(" · ");
    if (title.textContent !== titleText) title.textContent = titleText;
    if (meta.textContent !== metaText) meta.textContent = metaText;
    ordered.push(item);
  }
  for (const [index, item] of ordered.entries()) if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
  const kept = new Set(ordered);
  for (const item of [...list.children]) if (!kept.has(item)) item.remove();
}
$("#chat-search").addEventListener("input", renderSidebarChats);
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
  if (document.hidden) { hiddenRefresh = true; return; }
  refreshing = true;
  try {
    const requestedView = chatKey(viewedChat), requestedRange = $("#range").value;
    const query = new URLSearchParams({ range: $("#range").value });
    if (viewedChat) { query.set("chatId", viewedChat.id); query.set("source", viewedChat.source); }
    const snapshot = await api("/api/dashboard?" + query);
    if (requestedView !== chatKey(viewedChat) || requestedRange !== $("#range").value) { refreshPending = true; return; }
    const { state: s, aggregate: a, year, activity, chat, chats, timeline, recaps, pets } = snapshot;
    if (liveStream?.readyState === EventSource.OPEN) $("#connection").textContent = "Live on this device";
    function changed(name, render) {
      const signature = snapshot.versions?.[name] || JSON.stringify(snapshot[name]);
      if (renderedVersions.get(name) !== signature) { render(); renderedVersions.set(name, signature); }
    }
    petData = pets;
    if (!settingsDirty && cfg.pet?.id !== pets.selected) {
      cfg.pet = (await api("/api/config")).pet;
      if (tab === "Codex Pet Assets") settings();
    }
    changed("chat", () => renderChat(chat));
    changed("chats", () => renderChats(chats));
    changed("timeline", () => renderTimeline(timeline));
    changed("recaps", () => renderRecaps(recaps));
    $(".version").textContent = s.version || "";
    const t = a.totals || {},
      state = ["working", "thinking", "waiting", "idle"].includes(s.status)
        ? s.status
        : "idle";
    const visual = animationData.animations.some(({ id }) => id === s.visualState) ? s.visualState : state;
    $(".live").dataset.state = visual;
    const bundled =
      "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/";
    const configuredPet = activity?.assets?.large_image;
    const petName = configuredPet?.startsWith(bundled) ? configuredPet.slice(bundled.length).split(/[?#]/)[0] : "";
    const localPet = animationData.animations.some(({ id }) => petName === `codex-pet-${id}.gif`);
    const libraryPet = petData.pets.find((pet) => Object.values(pet.animations || {}).some((asset) => asset.url === configuredPet));
    const libraryAsset = libraryPet && Object.values(libraryPet.animations).find((asset) => asset.url === configuredPet);
    const petAnimated = libraryAsset?.path || (localPet ? `/assets/pet/${petName}` : configuredPet?.startsWith("https://") ? configuredPet : `/assets/pet/codex-pet-${visual}.gif`);
    const petStill = libraryAsset?.previewPath || (localPet ? `/assets/pet/${petName.replace(/\.gif$/, ".svg")}` : `/assets/pet/codex-pet-${visual}.svg`);
    animatePicture($("#pet"), petAnimated, petStill);
    $("#pet").style.imageRendering = libraryPet && libraryPet.id !== "codex" ? "auto" : "pixelated";
    const configuredBadge = activity?.assets?.small_image;
    const badgeName = configuredBadge?.startsWith(bundled) ? configuredBadge.slice(bundled.length).split(/[?#]/)[0] : "";
    const localBadge = /^codex-status-(working|thinking|waiting|idle|approval|editing|reading|review|ready|error|done)\.(png|gif)$/.test(badgeName);
    const badgeAnimated = localBadge ? `/assets/pet/${cfg.assets.badge ? badgeName : badgeName.replace(/\.png$/, ".gif")}` : configuredBadge?.startsWith("https://") ? configuredBadge : `/assets/pet/codex-status-${s.badgeKind || state}.gif`;
    const badgeStill = localBadge ? `/assets/pet/${badgeName.replace(/\.(png|gif)$/, ".png").replace("codex-status-done.png", "codex-status-waiting.png")}` : `/assets/pet/codex-status-${s.badgeKind || state}.png`;
    animatePicture($("#status-badge"), badgeAnimated, badgeStill);
    $("#activity-type").textContent =
      ((activity?.type ?? cfg.presence.type) === 3 ? "WATCHING" : "PLAYING") +
      ` ${activity?.name || "Codex"}`;
    $("#pet").alt = `Codex Pet ${visual}`;
    $("#live-status").textContent = s.enabled ? visual : "paused";
    $("#live-action").textContent = activity?.details || "Presence paused";
    $("#live-model").textContent =
      activity?.state || "Resume when you are ready.";
    liveState = s;
    renderElapsed();
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
    if (!unchanged(histogram, t.hours || [])) {
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
    }
  } catch (e) {
    $("#connection").textContent = e.message;
  } finally {
    refreshing = false;
    if (refreshPending) {
      refreshPending = false;
      scheduleRefresh();
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
  } else if (type === "activityType" || type === "statsStyle" || type === "timerStyle" || type === "petChoice") {
    input = document.createElement("select");
    const choices =
      type === "petChoice" ? petData.pets.map((pet) => [pet.id, pet.name]) : type === "timerStyle" ? [["operation", "Current operation"], ["session", "Whole session"]] : type === "activityType"
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
      settingsDirty = true;
      $("#save-status").textContent = "Unsaved changes";
    } catch {
      input.setCustomValidity("Enter valid JSON for buttons.");
      $("#save-status").textContent = "Enter valid JSON for buttons.";
    }
  });
  wrap.append(caption, input);
  return wrap;
}
function animationPicker() {
  const panel = document.createElement("section"); panel.className = "animation-picker";
  const heading = document.createElement("h3"); heading.textContent = "Find your pet’s next move";
  const description = document.createElement("p"); description.className = "muted";
  description.textContent = "Tools choose their matching scene automatically. Pick an animation below to customize a state, then save your changes.";
  const label = document.createElement("label"); label.className = "animation-target-label"; label.textContent = "Customize state";
  const select = document.createElement("select"); select.id = "animation-target";
  for (const scene of animationData.animations) {
    if (scene.id === "working" || !Object.hasOwn(cfg.assets, scene.id)) continue;
    const option = document.createElement("option"); option.value = scene.id; option.textContent = scene.label; select.append(option);
  }
  select.value = "writing"; label.append(select);
  const grid = document.createElement("div"); grid.className = "animation-options";
  const reduced = document.documentElement.dataset.motion === "reduced";
  for (const scene of animationData.animations.filter(({ id }) => id !== "working")) {
    const button = document.createElement("button"); button.type = "button"; button.className = "animation-option";
    button.dataset.animation = scene.id; button.title = scene.description; button.setAttribute("aria-label", `Use ${scene.label} for selected state`);
    if (cfg.pet?.id !== "codex") button.title = `Use the selected pet’s ${scene.label} animation`;
    const asset = petData.pets.find((pet) => pet.id === cfg.pet?.id)?.animations?.[scene.id];
    const picture = document.createElement("img"); picture.src = asset ? reduced ? asset.previewPath : asset.path : reduced ? scene.previewPath : scene.path; picture.alt = ""; picture.loading = "lazy"; picture.width = 96; picture.height = 104;
    picture.style.imageRendering = cfg.pet?.id === "codex" ? "pixelated" : "auto";
    animatePicture(picture, asset?.path || scene.path, asset?.previewPath || scene.previewPath);
    const caption = document.createElement("span"); caption.textContent = scene.label;
    button.append(picture, caption);
    button.addEventListener("click", () => {
      const input = document.querySelector(`[data-key="assets.${select.value}"]`);
      input.value = asset?.url || animationData.baseURL + `codex-pet-${scene.id}.gif?v=smooth-1`;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      markSelected();
      $("#save-status").textContent = `${scene.label} selected for ${select.selectedOptions[0].textContent}. Save changes to apply.`;
    });
    grid.append(button);
  }
  function markSelected() {
    const current = cfg.assets[select.value];
    for (const button of grid.children) button.setAttribute("aria-pressed", String(current?.split(/[?#]/)[0] === animationData.baseURL + `codex-pet-${button.dataset.animation}.gif`));
  }
  select.addEventListener("change", markSelected); markSelected();
  panel.append(heading, description, label, grid); return panel;
}

function settings() {
  queueMicrotask(updatePictures);
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
      ...Object.keys(cfg.assets).filter((id) => id !== "badge").map((id) => [
        `${animationData.animations.find((scene) => scene.id === id)?.label || id} GIF URL / key`, `assets.${id}`,
      ]),
      ["Status badge override", "assets.badge", "text", "Leave blank for automatic pixel tool badges."],
    ],
    Timing: Object.keys(cfg.timing).map((k) => [k, "timing." + k, "number"]),
    Privacy: [
      ["Sharing mode", "privacy", "privacy"],
      ["Detect ChatGPT Desktop", "chatgpt.enabled", "checkbox"],
    ],
    Stats: [["Scan local session logs", "stats.enabled", "checkbox"]],
  };
  if (tab === "Codex Pet Assets") {
    const picker = field("Base pet", "pet.id", "petChoice", "Choose a built-in or imported pet, then save changes.");
    picker.querySelector("select").addEventListener("change", () => {
      if (["codex", "codex-bloom"].includes(cfg.pet.id)) cfg.pet.baseUrl = "";
      settings();
    });
    content.append(picker);
    if (!["codex", "codex-bloom"].includes(cfg.pet.id)) {
      const hosting = field("Pet hosting folder", "pet.baseUrl", "url", "Public HTTPS folder containing the exported GIF files. Local previews do not need hosting.");
      hosting.querySelector("input").required = true;
      content.append(hosting);
    }
    const restore = document.createElement("button"); restore.type = "button"; restore.className = "text-button";
    restore.id = "restore-pet-scenes";
    restore.textContent = "Use this pet’s automatic scenes";
    restore.addEventListener("click", () => {
      for (const key of Object.keys(cfg.assets)) if (key !== "badge") cfg.assets[key] = animationData.baseURL + `codex-pet-${key}.gif?v=smooth-1`;
      settingsDirty = true; settings(); $("#save-status").textContent = "Scene overrides reset. Save changes to use the selected pet.";
    });
    content.append(restore);
    const advanced = document.createElement("details"); advanced.className = "asset-advanced";
    const summary = document.createElement("summary"); summary.textContent = "Custom image URLs and Discord asset keys";
    advanced.append(summary);
    for (const def of defs[tab]) (def[1] === "assets.badge" ? content : advanced).append(field(...def));
    content.append(advanced);
  } else {
    for (const def of defs[tab] || []) content.append(field(...def));
  }
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
    content.querySelector(".asset-advanced").before(animationPicker());
    const gallery = document.createElement("img");
    gallery.src = "/assets/pet/status-badges.svg";
    gallery.alt =
      "Ten pixel status badges: command, thinking, done, idle, approval, editing, reading, review, ready, error";
    gallery.className = "badge-gallery";
    content.append(gallery);
    const preview = document.createElement("a");
    preview.href = "#studio";
    preview.addEventListener("click", event => { event.preventDefault(); closeSettings(); navigate("studio"); });
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
$("#settings-form").addEventListener("input", () => { settingsDirty = true; });
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    cfg = await api("/api/config", cfg);
    settingsDirty = false;
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
  [cfg, animationData, petData] = await Promise.all([api("/api/config"), api("/api/animations"), api("/api/pets")]);
  settings();
  await refresh();
  const stream = liveStream = new EventSource("/events");
  stream.onopen = () => {
    $("#connection").textContent = "Live on this device";
    $("#stream-dot").style.background = "var(--success, #4daa77)";
  };
  stream.onerror = () => {
    $("#connection").textContent = "Reconnecting…";
    $("#stream-dot").style.background = "var(--warning, #c5975d)";
  };
  stream.addEventListener("update", scheduleRefresh);
} catch (e) {
  $("#connection").textContent = e.message;
}

function scheduleRefresh() {
  if (document.hidden) { hiddenRefresh = true; return; }
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 20);
}
document.addEventListener("visibilitychange", () => {
  updatePictures(); studioAppearance();
  if (!document.hidden && hiddenRefresh) { hiddenRefresh = false; scheduleRefresh(); }
});

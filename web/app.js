const $ = (s) => document.querySelector(s),
  format = (n) =>
    Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n || 0);
let cfg,
  token,
  tab = "Presence",
  refreshing = false;
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
      b.style.background = [
        "#202f36",
        "#285a48",
        "#318565",
        "#44bc8b",
        "#67efbd",
      ][value ? Math.max(1, Math.ceil((value / max) * 4)) : 0];
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
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [s, a, year] = await Promise.all([
      api("/api/state"),
      api("/api/aggregate?range=" + $("#range").value),
      api("/api/aggregate?range=1y"),
    ]);
    const t = a.totals || {},
      state = ["working", "thinking", "waiting", "idle"].includes(s.status)
        ? s.status
        : "idle";
    $("#pet").src = `/assets/pet/codex-pet-${state}.gif`;
    $("#pet").alt = `Codex Pet ${state}`;
    $("#live-status").textContent = s.enabled ? state : "paused";
    $("#live-action").textContent =
      s.source === "chatgpt"
        ? "ChatGPT · Pair programming"
        : s.project
          ? `Working on ${s.project}`
          : {
              working: "Making things happen.",
              thinking: "A thought in progress.",
              waiting: "Your move, human.",
              idle: "Ready when you are.",
            }[state];
    $("#live-model").textContent = `${s.model || "Codex"} · ${s.tool || state}`;
    $("#live-source").textContent =
      s.source === "chatgpt" ? "ChatGPT Desktop" : "Codex CLI";
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
          : type === "number"
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
  for (const name of categories) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "tab";
    b.setAttribute("aria-selected", name === tab);
    b.textContent = name;
    b.addEventListener("click", () => {
      tab = name;
      settings();
    });
    tabs.append(b);
  }
  const content = $("#settings-content");
  content.replaceChildren();
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
      "Private mode redacts project names from the live state and file paths from aggregate output. Existing scanner cache remains local.",
    Stats:
      "Lifetime totals come from local Codex JSONL logs. ChatGPT process detection cannot reveal tokens.",
  };
  intro.textContent = descriptions[tab];
  content.append(intro);
  const defs = {
    Presence: [
      ["Presence enabled", "enabled", "checkbox"],
      [
        "Buttons (up to two)",
        "buttons",
        "textarea",
        '[{"label":"View GitHub","url":"https://github.com/you/repo"}]',
      ],
    ],
    Discord: [["Application ID", "clientId", "text"]],
    "Codex Pet Assets": [
      ["Working GIF URL / key", "assets.working"],
      ["Thinking GIF URL / key", "assets.thinking"],
      ["Waiting GIF URL / key", "assets.waiting"],
      ["Idle GIF URL / key", "assets.idle"],
      ["Small badge URL / key", "assets.badge"],
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
    $("#stream-dot").style.background = "#78edbe";
  };
  stream.onerror = () => {
    $("#connection").textContent = "Reconnecting…";
    $("#stream-dot").style.background = "#f9ce78";
  };
  stream.addEventListener("update", refresh);
} catch (e) {
  $("#connection").textContent = e.message;
}

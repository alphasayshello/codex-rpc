import { config, readJSON, alive } from "./store.js";
import { emptyStats, streaks, mergeStats } from "./scanner.js";
export const pet = "  /\\__/\\\n [ ▪  ▪ ]  codex pet\n  /|__|\\   >_";
const compact = (n) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);
const color = (n, s) =>
  process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s;
export function usageBar(n, max, width = 20) {
  const ratio = max ? Math.min(1, n / max) : 0;
  return (
    color(
      ratio > 0.75 ? 31 : ratio > 0.4 ? 33 : 32,
      "█".repeat(Math.round(ratio * width)),
    ) + "░".repeat(width - Math.round(ratio * width))
  );
}
export function heatmap(days = {}, now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 363 - start.getUTCDay());
  let rows = [];
  const values = Object.values(days).map((s) => s.tokens || s.prompts || 0),
    max = Math.max(1, ...values);
  for (let dow = 0; dow < 7; dow++) {
    let row = "SMTWTFS"[dow] + " ";
    for (let week = 0; week < 52; week++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + week * 7 + dow);
      const s = days[d.toISOString().slice(0, 10)] || {};
      const v = s.tokens || s.prompts || 0;
      row +=
        d > end
          ? " "
          : color(
              v ? 32 : 90,
              "·░▒▓█"[v ? Math.max(1, Math.ceil((v / max) * 4)) : 0],
            );
    }
    rows.push(row);
  }
  return rows.join("\n");
}
export function rangeAggregate(a, range = "all", now = new Date()) {
  if (range === "all") return a;
  const n = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range];
  if (!n) throw Error("Invalid range");
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - n + 1);
  const first = cutoff.toISOString().slice(0, 10);
  const days = Object.fromEntries(
    Object.entries(a.days || {}).filter(
      ([d]) => d >= first && d <= now.toISOString().slice(0, 10),
    ),
  );
  const totals = emptyStats();
  for (const s of Object.values(days)) mergeStats(totals, s);
  totals.activeHours = totals.activeSeconds / 3600;
  return { ...a, totals, days, streak: streaks(days, now) };
}
export function renderStatus({ usage = false } = {}) {
  const s = readJSON("state.json", { status: "idle" }),
    a = readJSON("aggregate.json", {
      totals: emptyStats(),
      days: {},
      streak: { current: 0 },
    }),
    d = readJSON("daemon.json"),
    t = a.totals || emptyStats();
  const lines = [
    color(36, "codex-rpc / a little presence."),
    pet,
    `\n${config().enabled ? "enabled" : "paused"} · daemon ${alive(d.pid) ? "running" : "stopped"} · Discord ${d.connected ? "connected" : "offline"}`,
    `Live: ${s.status || "idle"} · ${s.model || "unknown model"} · ${config().privacy === "public" ? s.project || "Codex" : "private project"}`,
    `${compact(t.tokens)} tokens · ${t.sessions} sessions · ${(t.activeHours || 0).toFixed(1)}h · ${a.streak?.current || 0} day streak`,
    `API equivalent: $${(t.cost || 0).toFixed(4)} (estimate; ${compact(t.unknownCostTokens)} unpriced tokens)`,
  ];
  if (usage) {
    lines.push("\n52 weeks · UTC", heatmap(a.days), "\nHour histogram · UTC");
    const max = Math.max(1, ...t.hours);
    t.hours.forEach((v, i) =>
      lines.push(`${String(i).padStart(2, "0")} ${usageBar(v, max, 12)} ${v}`),
    );
    for (const [label, map] of [
      ["Tools", t.tools],
      ["Languages", t.languages],
    ]) {
      lines.push("\n" + label);
      const top = Object.entries(map || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      for (const [k, v] of top)
        lines.push(`${k.padEnd(20)} ${usageBar(v, top[0][1], 12)} ${v}`);
      if (!top.length) lines.push("No recorded activity yet.");
    }
  }
  return lines.join("\n");
}
export function insights(
  a = readJSON("aggregate.json", {
    totals: emptyStats(),
    days: {},
    streak: { current: 0 },
  }),
  now = new Date(),
) {
  const week = rangeAggregate(a, "7d", now),
    previousEnd = new Date(now);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 7); // Compare disjoint calendar weeks.
  const priorTokens = Object.entries(a.days || {})
    .filter(
      ([d]) =>
        d <= previousEnd.toISOString().slice(0, 10) &&
        d >= new Date(+previousEnd - 6 * 86400000).toISOString().slice(0, 10),
    )
    .reduce((n, [, s]) => n + s.tokens, 0);
  const weekdays = Array(7).fill(0);
  for (const [d, s] of Object.entries(week.days || {}))
    if (d !== "unknown")
      weekdays[new Date(d + "T00:00:00Z").getUTCDay()] += s.tokens;
  const peak = weekdays.indexOf(Math.max(...weekdays));
  const hotspot = Object.entries(week.totals.files || {}).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return [
    `This week: ${compact(week.totals.tokens)} tokens; ${priorTokens ? `${((week.totals.tokens / priorTokens - 1) * 100).toFixed(0)}% versus the prior week` : "no prior-week baseline yet"}.`,
    `Peak coding weekday: ${weekdays.some(Boolean) ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][peak] + " (UTC)" : "waiting for recorded activity"}.`,
    `Hotspot: ${config().privacy === "public" && hotspot ? hotspot[0] + " · " + hotspot[1] + " tool touches" : "redacted or no file activity"}.`,
    `Pace: ${compact(week.totals.tokens / 7)} tokens/day · $${(week.totals.cost / 7).toFixed(4)}/day API equivalent.`,
    `Streak: ${a.streak?.current || 0} days; best ${a.streak?.longest || 0}. ${a.streak?.current ? "Keep it going." : "One prompt starts a new streak."}`,
  ].join("\n");
}

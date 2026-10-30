import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xml, readJSON } from "./store.js";
import { emptyStats } from "./scanner.js";
const pet = () =>
  fs.readFileSync(
    new URL("../assets/pet/codex-pet-working.svg", import.meta.url),
    "utf8",
  );
const number = (n) =>
  Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);
export function heatmapSVG(
  a = {},
  now = new Date(),
  { standalone = true } = {},
) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364 - start.getUTCDay());
  const max = Math.max(
    1,
    ...Object.values(a.days || {}).map((s) => s.tokens || s.prompts || 0),
  );
  let rects = "",
    months = "",
    last = "";
  for (let col = 0; col < 53; col++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + col * 7);
    const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
    if (month !== last) {
      months += `<text x="${col * 12}" y="12" fill="#a4b8b0" font-size="9">${month}</text>`;
      last = month;
    }
    for (let row = 0; row < 7; row++) {
      const date = new Date(d);
      date.setUTCDate(date.getUTCDate() + row);
      if (date > end) continue;
      const day = date.toISOString().slice(0, 10),
        s = a.days?.[day] || {},
        n = s.tokens || s.prompts || 0;
      const fill = ["#263943", "#285a48", "#318565", "#44bc8b", "#67efbd"][
        n ? Math.max(1, Math.ceil((n / max) * 4)) : 0
      ];
      rects += `<rect x="${col * 12}" y="${24 + row * 12}" width="9" height="9" rx="2" fill="${fill}"><title>${day}: ${n} tokens/activity</title></rect>`;
    }
  }
  const content = `<g font-family="monospace">${months}${rects}</g>`;
  return standalone
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="140" viewBox="0 0 680 140" role="img" aria-label="12 month activity heatmap"><rect width="680" height="140" rx="12" fill="#101820"/><g transform="translate(20 12)">${content}</g></svg>`
    : content;
}
export function statsSVG(a = {}) {
  const t = a.totals || emptyStats();
  const metrics = [
    ["TOKENS", number(t.tokens)],
    ["SESSIONS", t.sessions || 0],
    ["HOURS", (t.activeHours || 0).toFixed(1)],
    ["STREAK", `${a.streak?.current || 0}d`],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="310" viewBox="0 0 720 310" role="img" aria-label="Codex lifetime statistics"><rect width="720" height="310" rx="16" fill="#101820"/><text x="28" y="35" font-family="monospace" font-size="20" fill="#67efbd">codex-rpc / lifetime</text><image href="data:image/svg+xml;base64,${Buffer.from(pet()).toString("base64")}" x="580" y="4" width="112" height="112"/>${metrics.map(([k, v], i) => `<text x="${28 + i * 138}" y="78" fill="#e6e2d5" font-family="monospace" font-size="24">${xml(v)}</text><text x="${28 + i * 138}" y="101" fill="#a4b8b0" font-family="monospace" font-size="11">${k}</text>`).join("")}<g transform="translate(28 130)">${heatmapSVG(a, new Date(), { standalone: false })}</g><text x="28" y="284" fill="#a4b8b0" font-family="monospace" font-size="11">Local stats · UTC · $${(t.cost || 0).toFixed(4)} estimated API equivalent</text></svg>`;
}
export function badgeSVG(metric, a = {}) {
  const t = a.totals || {};
  const value = {
    tokens: number(t.tokens),
    sessions: t.sessions || 0,
    hours: (t.activeHours || 0).toFixed(1),
    streak: `${a.streak?.current || 0}d`,
  }[metric];
  if (value === undefined) throw Error("Unknown badge metric");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="24" role="img" aria-label="${metric}: ${xml(value)}"><rect width="180" height="24" rx="5" fill="#263943"/><path d="M90 0h85q5 0 5 5v14q0 5-5 5H90z" fill="#318565"/><g fill="#fff" text-anchor="middle" font-family="monospace" font-size="12"><text x="45" y="16">${metric}</text><text x="135" y="16">${xml(value)}</text></g></svg>`;
}
export function generateCards(output = path.resolve("statcards")) {
  fs.mkdirSync(output, { recursive: true });
  const a = readJSON("aggregate.json");
  fs.writeFileSync(path.join(output, "stats.svg"), statsSVG(a));
  fs.writeFileSync(path.join(output, "heatmap.svg"), heatmapSVG(a));
  for (const metric of ["tokens", "sessions", "hours", "streak"])
    fs.writeFileSync(path.join(output, metric + ".svg"), badgeSVG(metric, a));
  const md =
    "![Codex stats](./stats.svg)\n\n![12-month heatmap](./heatmap.svg)\n\n" +
    ["tokens", "sessions", "hours", "streak"]
      .map((m) => `![${m}](./${m}.svg)`)
      .join(" ") +
    "\n";
  fs.writeFileSync(path.join(output, "README.md"), md);
  return output;
}

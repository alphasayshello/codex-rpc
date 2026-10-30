import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { sandbox } from "./helpers.js";
import { serve } from "../src/server.js";
import { writeJSON, config } from "../src/store.js";
import { emptyStats } from "../src/scanner.js";
import {
  statsSVG,
  heatmapSVG,
  badgeSVG,
  generateCards,
} from "../src/statcards.js";
import { rangeAggregate, insights, heatmap } from "../src/tui.js";
test("dashboard serves APIs/assets, live SVG, settings CSRF protection and ranges", async (t) => {
  let server, controller;
  t.after(async () => { controller?.abort(); await server?.closeDashboard(); });
  sandbox(t);
  server = await serve(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  writeJSON("state.json", { status: "working", source: "codex" });
  writeJSON("aggregate.json", {
    totals: { ...emptyStats(), tokens: 123 },
    days: {},
    streak: { current: 0 },
  });
  assert.equal((await (await fetch(url + "/api/presence")).json()).type, 3);
  assert.equal(
    (await (await fetch(url + "/api/state")).json()).status,
    "working",
  );
  assert.equal(
    (await (await fetch(url + "/api/aggregate")).json()).totals.tokens,
    123,
  );
  const unknownChat = await (await fetch(url + "/api/chat")).json();
  assert.equal(unknownChat.tokens, null);
  writeJSON("state.json", { status: "working", source: "codex", sessionId: "api-chat", model: "o3", tokens: 1000, tool: "apply_patch" });
  writeJSON("sessions.json", { sessions: { "api-chat": { id: "api-chat", source: "codex", usageKnown: true, totals: { ...emptyStats(), tokens: 1000, input: 800, output: 200, prompts: 3, toolCalls: 5, files: { "secret.js": 1 } } } } });
  const chat = await (await fetch(url + "/api/chat")).json();
  assert.equal(chat.tokens, 1000);
  assert.equal(chat.input, 800);
  assert.equal(chat.toolCalls, 5);
  assert.deepEqual(chat.files, {});
  assert.equal(chat.title, "Private conversation");
  const chatCard = await (await fetch(url + "/api/presence")).json();
  assert.match(chatCard.state, /^Editing files · o3 · 200 output tokens$/);
  assert.equal((await fetch(url + "/api/aggregate?range=oops")).status, 400);
  assert.equal(
    await new Promise((resolve, reject) => {
      http
        .get(url + "/", { headers: { host: "evil.example" } }, (r) => {
          r.resume();
          resolve(r.statusCode);
        })
        .on("error", reject);
    }),
    403,
  );
  assert.equal(
    (await fetch(url + "/api/config", { method: "POST", body: "{}" })).status,
    403,
  );
  const { token } = await (await fetch(url + "/api/session")).json();
  const headers = {
    "x-codex-rpc-token": token,
    "content-type": "application/json",
  };
  assert.equal(
    (
      await fetch(url + "/api/config", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/config", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...config(), privacy: "public" }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(url + "/api/config", {
        method: "POST",
        headers,
        body: '{"privacy":"invalid"}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/api/control", {
        method: "POST",
        headers,
        body: '{"action":"pause"}',
      })
    ).status,
    200,
  );
  assert.equal(config().enabled, false);
  for (const route of [
    "/",
    "/app.js",
    "/style.css",
    "/assets/pet/codex-pet-working.gif",
    "/assets/pet/codex-status-editing.png",
    "/assets/pet/status-badges.svg",
    "/cards/stats.svg",
    "/cards/heatmap.svg",
    "/cards/tokens.svg",
  ])
    assert.equal((await fetch(url + route)).status, 200, route);
  assert.equal((await fetch(url + "/api/recaps")).status, 200);
  assert.deepEqual((await (await fetch(url + "/api/recaps")).json()).rows, []);
  assert.equal((await fetch(url + "/assets/pet/codex-status-thinking.gif")).headers.get("content-type"), "image/gif");
  const catalog = await (await fetch(url + "/api/animations")).json();
  assert.equal(catalog.animations.length, 20);
  assert.equal(new Set(catalog.animations.map(({ id }) => id)).size, 20);
  assert.match(catalog.baseURL, /^https:\/\/raw\.githubusercontent\.com\//);
  for (const scene of catalog.animations) {
    for (const route of [scene.path, scene.previewPath]) {
      const response = await fetch(url + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get("content-type"), route.endsWith("gif") ? "image/gif" : "image/svg+xml");
    }
  }
  const gallery = await fetch(url + "/assets/pet/animation-gallery.html");
  assert.equal(gallery.status, 200);
  assert.match(gallery.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await fetch(url + "/assets/pet/animation-gallery.js")).headers.get("content-type"), "text/javascript");
  assert.equal((await fetch(url + "/assets/pet/animation-catalog.json")).status, 200);
  assert.equal((await fetch(url + "/assets/pet/manifest.json")).status, 200);
  assert.equal((await fetch(url + "/assets/pet/codex-pet-not-a-scene.gif")).status, 404);
  assert.equal((await fetch(url + "/assets/pet/codex-pet-constructor.gif")).status, 404);
  assert.equal((await fetch(url + "/not-a-route")).status, 404);
  controller = new AbortController();
  const response = await fetch(url + "/events", { signal: controller.signal });
  assert.match(response.headers.get("content-type"), /event-stream/);
  const reader = response.body.getReader();
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /event: update/,
  );
  const next = reader.read();
  writeJSON("state.json", { status: "waiting" });
  assert.match(new TextDecoder().decode((await next).value), /event: update/);
  controller.abort();
});
test("cards embed pet, expose 12 month heatmap and four badges; insights and range boundaries", (t) => {
  const { temp } = sandbox(t);
  const now = new Date("2026-10-29T12:00:00Z");
  const s = { ...emptyStats(), tokens: 100, activeSeconds: 3600 };
  const a = {
    totals: { ...s, activeHours: 1 },
    days: {
      "2026-10-29": s,
      "2026-10-28": s,
      "2026-10-01": s,
      "2026-10-30": s,
    },
    streak: { current: 2, longest: 3 },
  };
  const svg = statsSVG(a);
  assert.match(svg, /^<svg/);
  assert.match(svg, /data:image\/svg\+xml;base64/);
  assert.ok(svg.endsWith("</svg>"));
  const h = heatmapSVG(a, now);
  assert.ok((h.match(/<rect /g) || []).length >= 365);
  for (const metric of ["tokens", "sessions", "hours", "streak"])
    assert.match(badgeSVG(metric, a), new RegExp(metric));
  assert.throws(() => badgeSVG("bogus", a));
  assert.equal(rangeAggregate(a, "7d", now).totals.tokens, 200);
  assert.equal(rangeAggregate(a, "30d", now).totals.tokens, 300);
  assert.equal(insights(a, now).split("\n").length, 5);
  assert.equal(heatmap(a.days, now).split("\n").length, 7);
  writeJSON("aggregate.json", a);
  generateCards(temp + "/cards");
  assert.equal(fs.readdirSync(temp + "/cards").length, 7);
});

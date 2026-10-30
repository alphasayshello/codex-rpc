import http from "node:http";
import fs from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { config, validateConfig, readJSON, writeJSON, home } from "./store.js";
import { buildActivity, statusBadgeKind } from "./presence.js";
import { rangeAggregate } from "./tui.js";
import { emptyStats } from "./scanner.js";
import { statsSVG, heatmapSVG, badgeSVG } from "./statcards.js";
import { startDaemon, stopDaemon } from "./service.js";
export function createServer() {
  const token = randomBytes(24).toString("hex"),
    clients = new Set();
  let watcher, interval;
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const expected = `localhost:${address.port}`,
      alternate = `127.0.0.1:${address.port}`;
    if (![expected, alternate].includes(req.headers.host)) {
      res.writeHead(403).end("Invalid Host");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    let url;
    try {
      url = new URL(req.url, "http://" + expected);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const json = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const aggregate = () =>
      rangeAggregate(
        readJSON("aggregate.json", {
          totals: emptyStats(),
          days: {},
          streak: { current: 0, longest: 0 },
        }),
        url.searchParams.get("range") || "all",
      );
    try {
      if (req.method === "POST") {
        const origin = req.headers.origin;
        const supplied = Buffer.from(req.headers["x-codex-rpc-token"] || ""),
          known = Buffer.from(token);
        if (
          (origin &&
            ![`http://${expected}`, `http://${alternate}`].includes(origin)) ||
          supplied.length !== known.length ||
          !timingSafeEqual(supplied, known)
        ) {
          json(403, { error: "Invalid local request token/origin" });
          return;
        }
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 65536) {
            json(413, { error: "Request too large" });
            return;
          }
        }
        if (url.pathname === "/api/config") {
          const next = validateConfig(JSON.parse(text));
          writeJSON("config.json", next);
          json(200, next);
          return;
        }
        if (url.pathname === "/api/control") {
          const { action } = JSON.parse(text);
          if (action === "pause" || action === "resume")
            writeJSON("config.json", {
              ...config(),
              enabled: action === "resume",
            });
          else if (action === "start") await startDaemon();
          else if (action === "stop") await stopDaemon();
          else if (action === "restart") {
            await stopDaemon();
            await startDaemon();
          } else {
            json(400, { error: "Unknown action" });
            return;
          }
          json(200, { ok: true });
          return;
        }
        json(404, { error: "Not found" });
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      if (url.pathname === "/api/state") {
        const state = readJSON("state.json", { status: "idle" });
        if (config().privacy !== "public" || !config().presence.showTask)
          delete state.task;
        if (config().privacy === "private") {
          delete state.project;
          delete state.file;
          delete state.task;
        }
        if (
          state.updatedAt &&
          Date.now() - state.updatedAt > config().timing.idleMs
        )
          state.status = "idle";
        json(200, {
          ...state,
          badgeKind: statusBadgeKind(state),
          daemon: readJSON("daemon.json"),
          enabled: config().enabled,
        });
        return;
      }
      if (url.pathname === "/api/presence") {
        const state = readJSON("state.json", { status: "idle" });
        if (
          state.updatedAt &&
          Date.now() - state.updatedAt > config().timing.idleMs
        )
          state.status = "idle";
        json(200, buildActivity(state, readJSON("aggregate.json"), config()));
        return;
      }
      if (url.pathname === "/api/aggregate") {
        json(200, aggregate());
        return;
      }
      if (url.pathname === "/api/config") {
        json(200, config());
        return;
      }
      if (url.pathname === "/api/session") {
        json(200, { token });
        return;
      }
      if (url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 2000\nevent: update\ndata: {}\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (
        url.pathname === "/cards/stats.svg" ||
        url.pathname === "/cards/heatmap.svg" ||
        /^\/cards\/(tokens|sessions|hours|streak)\.svg$/.test(url.pathname)
      ) {
        const metric = url.pathname.split("/").pop().split(".")[0],
          a = aggregate();
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(
          metric === "stats"
            ? statsSVG(a)
            : metric === "heatmap"
              ? heatmapSVG(a)
              : badgeSVG(metric, a),
        );
        return;
      }
      const routes = {
        "/": ["../web/index.html", "text/html"],
        "/app.js": ["../web/app.js", "text/javascript"],
        "/style.css": ["../web/style.css", "text/css"],
        "/assets/pet/status-badges.svg": [
          "../assets/pet/status-badges.svg",
          "image/svg+xml",
        ],
      };
      if (
        /^\/assets\/pet\/codex-pet-(working|thinking|waiting|idle)\.(gif|svg)$/.test(
          url.pathname,
        )
      ) {
        routes[url.pathname] = [
          ".." + url.pathname,
          url.pathname.endsWith(".gif") ? "image/gif" : "image/svg+xml",
        ];
      }
      if (
        /^\/assets\/pet\/codex-status-(working|thinking|waiting|idle|approval|editing|reading|review|ready|error)\.png$/.test(
          url.pathname,
        )
      )
        routes[url.pathname] = [".." + url.pathname, "image/png"];
      const route = routes[url.pathname];
      if (!route) {
        json(404, { error: "Not found" });
        return;
      }
      res.writeHead(200, { "Content-Type": route[1] });
      res.end(fs.readFileSync(new URL(route[0], import.meta.url)));
    } catch (e) {
      json(
        e instanceof SyntaxError ||
          /Invalid range|setting|must|Invalid enabled|Assets|Timing|Use up/.test(
            e.message,
          )
          ? 400
          : 500,
        { error: e.message },
      );
    }
  });
  server.on("listening", () => {
    fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
    watcher = fs.watch(home(), (_, name) => {
      if (
        ["state.json", "aggregate.json", "config.json", "daemon.json"].includes(
          name,
        )
      )
        for (const c of clients)
          if (c.writableLength < 65536) c.write("event: update\ndata: {}\n\n");
    });
    interval = setInterval(() => {
      for (const c of clients) c.write(": heartbeat\n\n");
    }, 20000);
    interval.unref();
  });
  server.on("close", () => {
    watcher?.close();
    clearInterval(interval);
    for (const c of clients) c.end();
    clients.clear();
  });
  server.closeDashboard = () => {
    for (const c of clients) c.end();
    server.close();
  };
  return server;
}
export async function serve(port = 47474) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

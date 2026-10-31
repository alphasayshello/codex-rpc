import { getTurnRecaps } from "./recaps.js";
import { getToolTimeline } from "./timeline.js";
import { selectedState, listChats, pinChat, unpinChat } from "./selection.js";
import { getChatStats } from "./chat.js";
import http from "node:http";
import fs from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { config, validateConfig, readJSON, writeJSON, home } from "./store.js";
import { buildActivity, statusBadgeKind, getVisualState } from "./presence.js";
import { rangeAggregate } from "./tui.js";
import { emptyStats } from "./scanner.js";
import { statsSVG, heatmapSVG, badgeSVG } from "./statcards.js";
import { startDaemon, stopDaemon } from "./service.js";
import { watchDirectory } from "./directory-watch.js";
import { animationCatalog } from "./assets/generate-pet-gifs.js";
import { listPets, importPet, selectPet, exportPet, downloadPet, readPetAsset } from "./pets.js";
const animationIds = new Set(animationCatalog.map(({ id }) => id));
const appVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
let petUpload = false;
async function requestText(req, limit) {
  if (Number(req.headers["content-length"]) > limit) {
    req.resume(); throw Object.assign(Error("Request too large"), { statusCode: 413 });
  }
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw Object.assign(Error("Request too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function createServer() {
  const token = randomBytes(24).toString("hex"),
    clients = new Set();
  let watcher, interval, closing;
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    if (!address) { res.writeHead(503).end("Dashboard is closing"); return; }
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
        if (url.pathname === "/api/pets/import") {
          // Reserve before buffering: several authenticated uploads must not
          // each allocate an entire 65 MiB body while one worker is busy.
          if (petUpload) { req.resume(); json(409, { error: "Another pet import is in progress. Wait for it to finish" }); return; }
          petUpload = true;
          const timeout = setTimeout(() => req.destroy(), 30000);
          try {
            const text = await requestText(req, 65 * 1024 * 1024);
            clearTimeout(timeout);
            json(200, await importPet(JSON.parse(text)));
          } finally { clearTimeout(timeout); petUpload = false; }
          return;
        }
        const text = await requestText(req, 65536);
        if (url.pathname === "/api/pets/select") { json(200, selectPet(JSON.parse(text))); return; }
        if (url.pathname === "/api/pin") {
          const { id, source = "codex" } = JSON.parse(text);
          const pinned = id === null ? unpinChat() : pinChat(id, source);
          json(200, { ok: true, pinned, state: selectedState() });
          return;
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
      if (url.pathname === "/api/pets") {
        json(200, { pets: listPets(), selected: config().pet?.id || "codex" }); return;
      }
      const petExport = /^\/api\/pets\/([a-z0-9][a-z0-9-]{0,63})\/(export|download)$/.exec(url.pathname);
      if (petExport) {
        if (petExport[2] === "download") {
          const bytes = downloadPet(petExport[1]);
          res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${petExport[1]}.zip"` }); res.end(bytes);
        } else {
          const pack = exportPet(petExport[1]);
          res.setHeader("Content-Disposition", `attachment; filename="${petExport[1]}.pet.json"`); json(200, pack);
        }
        return;
      }
      const libraryAsset = /^\/(?:pets\/([a-z0-9][a-z0-9-]{0,63})|assets\/pets\/(codex-bloom))\/([a-z][a-z0-9-]{0,31}\.(?:gif|png))$/.exec(url.pathname);
      if (libraryAsset) {
        const asset = readPetAsset(libraryAsset[1] || libraryAsset[2], libraryAsset[3]);
        if (!asset) { json(404, { error: "Pet asset not found" }); return; }
        res.writeHead(200, { "Content-Type": asset.contentType }); res.end(asset.bytes); return;
      }
      if (url.pathname === "/api/animations") {
        json(200, { animations: animationCatalog, baseURL: "https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/" });
        return;
      }
      if (url.pathname === "/api/state") {
        const state = selectedState();
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
          visualState: getVisualState(state, config()),
          daemon: readJSON("daemon.json"),
          enabled: config().enabled,
          version: appVersion,
        });
        return;
      }
      if (url.pathname === "/api/presence") {
        const state = selectedState();
        if (
          state.updatedAt &&
          Date.now() - state.updatedAt > config().timing.idleMs
        )
          state.status = "idle";
        json(200, buildActivity(state, readJSON("aggregate.json"), config()));
        return;
      }
      if (url.pathname === "/api/chat") {
        json(200, getChatStats(selectedState()));
        return;
      }
      if (url.pathname === "/api/chats") {
        const saved = readJSON("selection.json");
        json(200, { chats: listChats(), pinned: saved.sessionId ? { id: saved.sessionId, source: saved.source } : null });
        return;
      }
      if (url.pathname === "/api/recaps") {
        const state = selectedState();
        json(200, { sessionId: state.sessionId || null, source: state.source || "codex", rows: getTurnRecaps(state, config()) });
        return;
      }
      if (url.pathname === "/api/timeline") {
        const state = selectedState();
        json(200, { sessionId: state.sessionId || null, source: state.source || "codex", rows: getToolTimeline(state, config()) });
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
        "/assets/pet/animation-gallery.js": ["../assets/pet/animation-gallery.js", "text/javascript"],
        "/assets/pet/source/codex-spritesheet-v4.png": ["../assets/pet/source/codex-spritesheet-v4.png", "image/png"],
        "/assets/pet/manifest.json": ["../assets/pet/manifest.json", "application/json"],
        "/assets/pet/animation-catalog.json": ["../assets/pet/animation-catalog.json", "application/json"],
        "/assets/pet/animation-gallery.css": ["../assets/pet/animation-gallery.css", "text/css"],
        "/assets/pet/animation-gallery.html": ["../assets/pet/animation-gallery.html", "text/html"],
        "/assets/pet/animation-spritesheet.png": ["../assets/pet/animation-spritesheet.png", "image/png"],
        "/assets/pet/status-badges.svg": [
          "../assets/pet/status-badges.svg",
          "image/svg+xml",
        ],
      };
      const petAsset = /^\/assets\/pet\/codex-pet-([a-z-]+)\.(gif|svg)$/.exec(url.pathname);
      if (petAsset && animationIds.has(petAsset[1])) {
        routes[url.pathname] = [
          ".." + url.pathname,
          url.pathname.endsWith(".gif") ? "image/gif" : "image/svg+xml",
        ];
      }
      if (
        /^\/assets\/pet\/codex-status-(working|thinking|waiting|idle|approval|editing|reading|review|ready|error|done)\.(png|gif)$/.test(
          url.pathname,
        )
      )
        routes[url.pathname] = [".." + url.pathname, url.pathname.endsWith(".gif") ? "image/gif" : "image/png"];
      const route = routes[url.pathname];
      if (!route) {
        json(404, { error: "Not found" });
        return;
      }
      let bytes;
      try { bytes = fs.readFileSync(new URL(route[0], import.meta.url)); }
      catch (error) { if (error.code === "ENOENT") { json(404, { error: "Not found" }); return; } throw error; }
      res.writeHead(200, { "Content-Type": route[1] });
      res.end(bytes);
    } catch (e) {
      json(
        [400, 404, 409, 413].includes(e.statusCode) ? e.statusCode : e instanceof SyntaxError ||
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
    watcher = watchDirectory(home(),
      ["state.json", "aggregate.json", "sessions.json", "selection.json", "config.json", "daemon.json"], () => {
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
  server.closeDashboard = (callback) => {
    // Release native watchers before waiting for HTTP/SSE connections, so
    // callers may remove the data directory as soon as shutdown begins.
    watcher?.close();
    clearInterval(interval);
    for (const c of clients) c.end();
    clients.clear();
    closing ||= new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      // Node 18 does not automatically dispose of idle keep-alive sockets.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
    if (callback) closing.then(() => callback(), callback);
    return closing;
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

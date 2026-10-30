import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { sandbox, until, mockDiscord } from "./helpers.js";
import { DiscordIPC, frame, socketPaths, buildActivity } from "../src/ipc.js";
import { backoff, rotateLog } from "../src/daemon.js";
import { file, config } from "../src/store.js";
test("Discord handshake, fragmented frames, activity ack, ping/pong, and disconnect", async (t) => {
  const { temp } = sandbox(t),
    socket =
      process.platform === "win32"
        ? `\\\\?\\pipe\\codex-rpc-ipc-${process.pid}`
        : path.join(temp, "discord.sock");
  const mock = await mockDiscord(t, socket);
  const client = new DiscordIPC("123456789", { paths: [socket], timeout: 300 });
  t.after(() => client.close());
  await client.connect();
  assert.equal(client.ready, true);
  const activity = buildActivity(
    {
      status: "working",
      project: "secret",
      model: "o4-mini",
      tokens: 142800,
      usage: { input: 120000, output: 22800 },
      sessionId: "ipc-chat",
      tool: "bash",
      startedAt: 1700000000000,
    },
    { totals: { activeHours: 20 }, streak: { current: 4 } },
    {
      ...config(),
      presence: { ...config().presence, stats: "tokens" },
      assets: { working: "https://example.com/pet.gif", badge: "codex" },
    },
  );
  await client.setActivity(activity);
  const sent = mock.received[0];
  assert.equal(sent.cmd, "SET_ACTIVITY");
  assert.equal(
    sent.args.activity.assets.large_image,
    "https://example.com/pet.gif",
  );
  assert.ok(!sent.args.activity.details.includes("secret"));
  assert.equal(sent.args.activity.timestamps.start, 1700000000);
  assert.match(sent.args.activity.state, /22.8k output tokens/);
  for (const peer of mock.peers) peer.write(frame(3, { ping: 1 }));
  await until(() => mock.received.some((x) => x.pong));
  client.close();
  await until(() => !client.ready);
});
test("state-specific pet assets, public naming, disabled clearing and cross-platform discovery", () => {
  for (const status of ["working", "thinking", "waiting", "idle"]) {
    const c = {
      enabled: true,
      presence: { stats: "chat" },
      privacy: "public",
      assets: { [status]: `https://host/${status}.gif` },
      buttons: [{ label: "View GitHub", url: "https://github.com" }],
    };
    const a = buildActivity({ status, project: "demo" }, {}, c);
    assert.equal(a.assets.large_image, `https://host/${status}.gif`);
    assert.match(a.details, /demo/);
    assert.equal(a.buttons, undefined);
  }
  assert.equal(buildActivity({}, {}, { enabled: false }), null);
  assert.match(buildActivity({ source: "chatgpt" }, {}, {}).details, /ChatGPT/);
  assert.equal(socketPaths("win32", {}).length, 10);
  assert.match(socketPaths("win32", {})[0], /pipe\\discord-ipc-0/);
  assert.ok(
    socketPaths("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }).includes(
      "/run/user/1000/discord-ipc-9",
    ),
  );
  assert.equal(
    socketPaths("linux", { CODEX_RPC_IPC: "/tmp/bridge" })[0],
    "/tmp/bridge",
  );
});
test("unavailable sockets, handshake timeout, capped jitter and 5 MiB log rotation", async (t) => {
  const { temp, rpc } = sandbox(t);
  const client = new DiscordIPC("123456", {
    paths: [path.join(temp, "missing")],
    timeout: 20,
  });
  await assert.rejects(client.connect(), /unavailable/);
  assert.equal(
    backoff(0, () => 0),
    750,
  );
  assert.equal(
    backoff(99, () => 0.5),
    60000,
  );
  fs.mkdirSync(rpc, { recursive: true });
  fs.writeFileSync(file("daemon.log"), Buffer.alloc(5 * 1024 * 1024));
  rotateLog("new line");
  assert.ok(fs.existsSync(file("daemon.log.1")));
  assert.match(fs.readFileSync(file("daemon.log"), "utf8"), /new line/);
});

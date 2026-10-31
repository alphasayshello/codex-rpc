import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox } from "./helpers.js";
import { config } from "../src/store.js";
import { buildActivity } from "../src/presence.js";
import { frame } from "../src/ipc.js";

test("every card layout keeps absolute file paths out of Discord frames, including old snapshots", (t) => {
  sandbox(t);
  const chat = { output: 22800, prompts: 6, model: "o4-mini" };
  for (const stats of ["telemetry", "chat", "cost", "tokens"]) {
    for (const filename of ["/Users/bamber/codexrpc/ok.ts", "C:\\Users\\bamber\\codexrpc\\ok.ts"]) {
      for (const fallback of [false, true]) {
        const state = { status: "working", tool: "apply_patch", project: "codexrpc",
          ...(fallback ? { currentFiles: [filename] } : { file: filename }) };
        const settings = { ...config(), privacy: "public", presence: { ...config().presence, stats } };
        const activity = buildActivity(state, {}, settings, chat);
        const wire = frame(1, { cmd: "SET_ACTIVITY", args: { activity } }).subarray(8).toString();
        assert.ok(!wire.includes("Users") && !wire.includes("bamber") && !wire.includes("C:"), wire);
        if (stats === "telemetry" || stats === "chat" && !fallback) assert.match(activity.state, /codexrpc\/ok.ts/);
        const hidden = JSON.stringify(buildActivity(state, {}, { ...settings, privacy: "private" }, chat));
        assert.ok(!hidden.includes("codexrpc") && !hidden.includes("ok.ts"), hidden);
        assert.equal(activity.type, 3);
        assert.equal(activity.name, "Codex");
      }
    }
  }
});

test("shell summaries are revalidated before display instead of trusting old cached arguments", (t) => {
  sandbox(t);
  const activity = buildActivity({ status: "working", tool: "exec_command",
    commandSummary: "node /Users/bamber/codexrpc/secret.js --token secret" }, {}, { ...config(), privacy: "public" }, { output: 20 });
  assert.match(activity.state, /^Running: node/);
  assert.ok(!JSON.stringify(activity).includes("secret"));
  assert.ok(!JSON.stringify(activity).includes("Users"));
});

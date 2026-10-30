import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox } from "./helpers.js";
import { config, defaults, validateConfig, animationStates, bonusAnimationStates, writeJSON } from "../src/store.js";
import { getVisualState, buildActivity, ASSET_BASE } from "../src/presence.js";
import { selectedState } from "../src/selection.js";
import { applyEvent } from "../src/hook.js";
const now = 1700000100000;
const chat = { model: "gpt-5", output: 2500, prompts: 2 };

test("current tools and safe commands select purposeful automatic scenes", () => {
  for (const [state, expected] of [
    [{ tool: "read_file" }, "reading"],
    [{ tool: "mcp__filesystem__read_text_file" }, "reading"],
    [{ tool: "list_directory" }, "reading"],
    [{ tool: "rg" }, "searching"],
    [{ tool: "grep" }, "searching"],
    [{ tool: "find" }, "searching"],
    [{ tool: "web_search" }, "searching"],
    [{ tool: "exec_command", commandSummary: "rg private-search-term" }, "searching"],
    [{ tool: "exec_command", commandSummary: "npm test --token secret" }, "testing"],
    [{ operationKind: "shell", tool: "exec", commandSummary: "npm run test" }, "testing"],
    [{ tool: "bash", commandSummary: "pytest" }, "testing"],
    [{ tool: "bash", commandSummary: "cargo test" }, "testing"],
    [{ tool: "bash", commandSummary: "go test" }, "testing"],
    [{ tool: "bash", commandSummary: "npm build" }, "building"],
    [{ tool: "bash", commandSummary: "npm run build" }, "building"],
    [{ tool: "bash", commandSummary: "cargo build" }, "building"],
    [{ tool: "bash", commandSummary: "go build" }, "building"],
    [{ tool: "bash", commandSummary: "npm install private-package" }, "installing"],
    [{ tool: "bash", commandSummary: "npm ci" }, "installing"],
    [{ tool: "bash", commandSummary: "pnpm install" }, "installing"],
    [{ tool: "bash", commandSummary: "git diff private-file" }, "reviewing"],
    [{ tool: "review_changes" }, "reviewing"],
    [{ tool: "exec_command", commandSummary: "node private-script.js" }, "terminal"],
    [{ tool: "bash" }, "terminal"],
    [{ tool: "exec", operationKind: "shell" }, "terminal"],
    [{ tool: "exec", operationKind: "editing", commandSummary: "npm test" }, "patching"],
    [{ tool: "apply_patch" }, "patching"],
    [{ tool: "write_file" }, "patching"],
    [{ tool: "exec" }, "writing"],
    [{}, "writing"],
  ]) assert.equal(getVisualState({ status: "working", ...state }, {}, now), expected, JSON.stringify(state));
});
test("explicit scene IDs are allowlisted, stable and never constructed from filenames", () => {
  assert.equal(bonusAnimationStates.length, 12);
  for (const visualState of animationStates)
    assert.equal(getVisualState({ status: "working", tool: "read_file", visualState, eventTime: now }, {}, now), visualState);
  for (const visualState of ["../../secret", "https://evil.invalid/secret.gif", "constructor", "__proto__", "reading.gif", { toString: () => "reading" }])
    assert.equal(getVisualState({ status: "working", tool: "read_file", visualState }, {}, now), "reading");
  const state = { status: "working", tool: "exec_command", commandSummary: "npm test", operationStartedAt: now };
  for (const elapsed of [0, 1000, 15000, 60000, 86400000]) assert.equal(getVisualState(state, {}, now + elapsed), "testing");
  assert.equal(getVisualState({ status: "working", visualState: "writing", tool: "read_file" }), "writing");
});
test("errors, thinking, approval and bounded success preserve lifecycle semantics", () => {
  assert.equal(getVisualState({ status: "thinking", tool: "exec_command", commandSummary: "npm test" }), "thinking");
  assert.equal(getVisualState({ status: "waiting", waitingReason: "approval" }), "waiting");
  assert.equal(getVisualState({ status: "working", visualState: "error", tool: "read_file" }), "error");
  assert.equal(getVisualState({ status: "waiting", waitingReason: "error", visualState: "reading" }), "error");
  assert.equal(getVisualState({ status: "waiting", waitingReason: "done", eventTime: now - 1000 }, {}, now), "done");
  assert.equal(getVisualState({ status: "waiting", waitingReason: "done", visualState: "celebrating", eventTime: now - 1000 }, {}, now), "celebrating");
  assert.equal(getVisualState({ status: "waiting", waitingReason: "done", visualState: "celebrating", eventTime: now - 16000 }, {}, now), "idle");
  assert.equal(getVisualState({ status: "idle", visualState: "error" }), "idle");
  assert.equal(getVisualState({ status: "idle", visualState: "done" }), "idle");
  assert.equal(getVisualState({ status: "idle", visualState: "idle-cozy" }), "idle-cozy");
});
test("new scene defaults and overrides use the existing safe asset configuration", (t) => {
  sandbox(t);
  for (const scene of bonusAnimationStates) assert.equal(defaults.assets[scene], `${ASSET_BASE}/codex-pet-${scene}.gif?v=smooth-1`);
  const assets = Object.fromEntries(bonusAnimationStates.map((scene) => [scene, `custom_${scene.replaceAll("-", "_")}`]));
  const settings = validateConfig({ ...config(), assets: { ...config().assets, ...assets } });
  assert.equal(settings.assets.testing, "custom_testing");
  for (const assets of [{ "../../secret": "safe" }, { testing: "javascript:alert(1)" }, { reading: "http://example.com/pet.gif" }, { constructor: "safe" }])
    assert.throws(() => validateConfig({ ...config(), assets }), /Assets/);
});
test("automatic scene assets preserve legacy working overrides and intentional scene choices", (t) => {
  sandbox(t);
  const base = config(), state = { status: "working", tool: "exec_command", commandSummary: "npm test" };
  assert.match(buildActivity(state, {}, base, chat, now).assets.large_image, /codex-pet-testing\.gif/);
  const legacy = { ...base, assets: { ...base.assets, working: "https://example.com/my-pet.gif" } };
  for (const state of [{ status: "working", tool: "read_file" }, { status: "working", tool: "bash" }, { status: "working", tool: "apply_patch" }])
    assert.equal(buildActivity(state, {}, legacy, chat, now).assets.large_image, "https://example.com/my-pet.gif");
  assert.equal(buildActivity(state, {}, legacy, chat, now).assets.large_image, "https://example.com/my-pet.gif");
  const custom = { ...legacy, assets: { ...legacy.assets, testing: "my_test_animation" } };
  assert.equal(buildActivity(state, {}, custom, chat, now).assets.large_image, "my_test_animation");
  assert.match(buildActivity({ ...state, visualState: "testing" }, {}, legacy, chat, now).assets.large_image, /codex-pet-testing/);
});
test("private scene selection never exposes command operands or file metadata", (t) => {
  sandbox(t);
  const state = { status: "working", tool: "exec_command", commandSummary: "npm test --token secret-token", file: "secret/company.js", currentFiles: ["secret/company.js"], branch: "secret-branch", project: "secret-project" };
  const payload = buildActivity(state, {}, config(), chat, now);
  const text = JSON.stringify(payload);
  for (const secret of ["secret-token", "company.js", "secret-branch", "secret-project"]) assert.ok(!text.includes(secret));
  assert.match(payload.assets.large_image, /codex-pet-testing/);
  writeJSON("state.json", { status: "thinking", visualState: "../../secret-file.gif" });
  assert.equal(selectedState().visualState, undefined);
  writeJSON("state.json", { status: "thinking", visualState: "focus" });
  assert.equal(selectedState().visualState, "focus");
});

test("real hook shell metadata selects testing without an explicit scene hint", (t) => {
  sandbox(t);
  writeJSON("config.json", { ...config(), privacy: "public" });
  const state = applyEvent({ type: "custom_tool_call", sessionId: "scene-hook", timestamp: now,
    payload: { type: "custom_tool_call", name: "exec", call_id: "test-call", input: 'await tools.exec_command({cmd: "npm test --token private-token"});' } });
  assert.equal(state.visualState, undefined);
  assert.equal(state.operationKind, "shell");
  assert.equal(state.commandSummary, "npm test");
  assert.equal(getVisualState(state, config(), now), "testing");
  assert.match(buildActivity(state, {}, config(), chat, now).assets.large_image, /codex-pet-testing/);
});

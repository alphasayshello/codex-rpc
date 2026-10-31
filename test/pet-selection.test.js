import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox } from "./helpers.js";
import { config, validateConfig } from "../src/store.js";
import { buildActivity } from "../src/presence.js";
import { normalizePetBaseUrl } from "../src/pet-url.js";

test("pet configuration upgrades old settings and rejects unsafe hosting URLs", (t) => {
  sandbox(t);
  assert.deepEqual(config().pet, { id: "codex", baseUrl: "" });
  assert.equal(validateConfig({ pet: { id: "codex-bloom" } }).pet.id, "codex-bloom");
  assert.equal(normalizePetBaseUrl("https://raw.githubusercontent.com/example/pets/main/my-pet"), "https://raw.githubusercontent.com/example/pets/main/my-pet/");
  for (const baseUrl of ["http://example.com/pet", "https://localhost/pet", "https://127.0.0.1/pet", "https://[::1]/pet", "https://private.local/pet", "https://u:p@example.com/pet", "https://example.com/pet?key=secret", "https://example.com/pet#fragment", "https://example.com:47474/pet"])
    assert.throws(() => validateConfig({ pet: { baseUrl } }), /Pet base URL/, baseUrl);
  for (const pet of [null, [], "codex", { id: "../outside" }, { id: "codex", unknown: true }])
    assert.throws(() => validateConfig({ pet }), /[Pp]et/);
});

test("selected builtin pet reaches Discord while explicit scene overrides remain in force", (t) => {
  sandbox(t);
  const settings = { ...config(), pet: { id: "codex-bloom", baseUrl: "" } };
  const state = { status: "working", tool: "apply_patch" };
  const activity = buildActivity(state, {}, settings, { output: 123 });
  assert.match(activity.assets.large_image, /\/assets\/pets\/codex-bloom\/.+\.gif/);
  assert.equal(activity.name, "Codex");
  const overridden = buildActivity(state, {}, { ...settings, assets: { ...settings.assets, patching: "https://example.com/custom.gif" } }, { output: 123 });
  assert.equal(overridden.assets.large_image, "https://example.com/custom.gif");
  const legacy = buildActivity(state, {}, { ...settings, assets: { ...settings.assets, working: "https://example.com/legacy.gif" } }, { output: 123 });
  assert.equal(legacy.assets.large_image, "https://example.com/legacy.gif");
});

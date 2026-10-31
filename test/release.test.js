import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { assembleRelease } from "../scripts/assemble-release.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("release assembly verifies all platforms and aliases, and rejects corrupt or incomplete builds", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "input"), output = path.join(root, "output");
  for (const platform of ["darwin-arm64", "linux-x64", "win32-x64"]) {
    const directory = path.join(input, platform); fs.mkdirSync(directory, { recursive: true });
    const files = { "codex-rpc-0.3.1.tgz": platform + " archive", "codex-rpc.tgz": platform + " archive", [`codex-rpc-0.3.1-${platform}${platform === "win32-x64" ? ".exe" : ""}`]: platform + " binary" };
    for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), data);
    fs.writeFileSync(path.join(directory, "SHA256SUMS"), Object.entries(files).map(([name, data]) => `${hash(data)}  ${name}`).join("\n") + "\n");
  }
  const manifest = assembleRelease(input, output, { version: "0.3.1", revision: "fixture" });
  assert.equal(manifest.artifacts.length, 5);
  assert.equal(fs.readFileSync(path.join(output, "codex-rpc.tgz"), "utf8"), "linux-x64 archive");
  assert.equal(fs.readFileSync(path.join(output, "SHA256SUMS"), "utf8").trim().split("\n").length, 6);
  fs.writeFileSync(path.join(input, "win32-x64", "codex-rpc-0.3.1-win32-x64.exe"), "corrupted");
  assert.throws(() => assembleRelease(input, output, { version: "0.3.1" }), /Checksum mismatch/);
  fs.rmSync(path.join(input, "win32-x64"), { recursive: true });
  assert.throws(() => assembleRelease(input, output, { version: "0.3.1" }), /Missing verified artifact/);
});

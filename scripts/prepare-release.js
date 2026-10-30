import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const name of ["package-lock.json", "electron/package.json", "electron/package-lock.json"]) {
  if (JSON.parse(fs.readFileSync(name, "utf8")).version !== pkg.version) throw Error(`Version mismatch: ${name}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error("Expected a stable semantic version");
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw Error("Release tag does not match package version");
const directory = path.resolve("dist/release", `${process.platform}-${process.arch}`);
fs.mkdirSync(directory, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Invoke npm through its JS entrypoint when available, without a shell.
const npmCLI = process.env.npm_execpath;
if (process.platform === "win32" && !npmCLI) throw Error("Run through npm run release:prepare on Windows");
const packed = JSON.parse(execFileSync(npmCLI ? process.execPath : npm, [...(npmCLI ? [npmCLI] : []), "pack", "--json", "--pack-destination", directory], { encoding: "utf8" }))[0];
for (const required of ["src/selection.js", "src/timeline.js", "src/watcher.js", "src/config.js", "src/presence-scheduler.js", "src/recaps.js", "bin/codex-rpc.js", "assets/pet/codex-pet-writing.gif", "assets/pet/codex-pet-patching.gif", "assets/pet/codex-pet-error.gif", "assets/pet/codex-pet-done.gif"]) {
  if (!packed.files.some((entry) => entry.path === required)) throw Error(`Missing package file: ${required}`);
}
// Stable filename keeps GitHub /releases/latest/download links evergreen.
const latestName = "codex-rpc.tgz";
fs.copyFileSync(path.join(directory, packed.filename), path.join(directory, latestName));
const artifacts = [packed.filename, latestName];
if (process.argv.includes("--sea")) {
  execFileSync(process.execPath, ["scripts/build-sea.js"], { stdio: "inherit" });
  const exe = process.platform === "win32" ? ".exe" : "";
  const name = `codex-rpc-${pkg.version}-${process.platform}-${process.arch}${exe}`;
  const destination = path.join(directory, name);
  fs.copyFileSync(path.resolve("dist/codex-rpc" + exe), destination);
  fs.chmodSync(destination, 0o755);
  const version = execFileSync(destination, ["version"], { encoding: "utf8" }).trim();
  if (version !== pkg.version) throw Error("Standalone version smoke check failed");
  artifacts.push(name);
}
fs.copyFileSync("docs/RELEASE.md", path.join(directory, "RELEASE.md"));
fs.copyFileSync(`docs/RELEASE-NOTES-v${pkg.version}.md`, path.join(directory, "RELEASE-NOTES.md"));
fs.writeFileSync(path.join(directory, "SHA256SUMS"), artifacts.map((name) => `${createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")}  ${name}`).join("\n") + "\n");
console.log(`Release ${pkg.version}: ${directory}`);
console.log("Archives prepared locally. Nothing was uploaded or published.");

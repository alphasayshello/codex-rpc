import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export function assembleRelease(input, output, { version, revision, buildRun } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw Error("Expected a release version");
  const verified = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === "SHA256SUMS") {
        for (const line of fs.readFileSync(file, "utf8").trim().split(/\r?\n/)) {
          const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
          if (!match) throw Error(`Invalid checksum entry in ${file}`);
          const target = path.join(directory, match[2]);
          if (sha256(target) !== match[1]) throw Error(`Checksum mismatch: ${target}`);
          const files = verified.get(match[2]) || [];
          files.push(target); verified.set(match[2], files);
        }
      }
    }
  };
  walk(input);
  const binaries = ["darwin-arm64", "linux-x64", "win32-x64.exe"].map((platform) => `codex-rpc-${version}-${platform}`);
  const archive = `codex-rpc-${version}.tgz`;
  for (const name of [...binaries, archive, "codex-rpc.tgz"])
    if (!verified.has(name)) throw Error(`Missing verified artifact: ${name}`);
  // npm's archive metadata can differ by build OS. Publish both aliases from
  // one build, preferring Linux, rather than mixing platform-specific archives.
  const source = verified.get(archive).find((file) => file.replaceAll("\\", "/").includes("/linux-x64/")) || verified.get(archive)[0];
  const alias = path.join(path.dirname(source), "codex-rpc.tgz");
  if (!verified.get("codex-rpc.tgz").includes(alias) || sha256(alias) !== sha256(source)) throw Error("Tarball aliases differ");
  fs.mkdirSync(output, { recursive: true });
  for (const name of [archive, "codex-rpc.tgz", ...binaries]) {
    const original = name === archive ? source : name === "codex-rpc.tgz" ? alias : verified.get(name)[0];
    fs.copyFileSync(original, path.join(output, name));
  }
  const names = [archive, "codex-rpc.tgz", ...binaries];
  const manifest = { version, revision, buildRun, artifacts: names.map((name) => ({ name, bytes: fs.statSync(path.join(output, name)).size, sha256: sha256(path.join(output, name)) })) };
  fs.writeFileSync(path.join(output, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(output, "SHA256SUMS"), [...names, "release.json"].map((name) => `${sha256(path.join(output, name))}  ${name}`).join("\n") + "\n");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const manifest = assembleRelease(process.argv[2], process.argv[3], {
    version, revision: process.env.GITHUB_SHA,
    buildRun: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined,
  });
  console.log(`Verified ${manifest.artifacts.length} release downloads for ${version}`);
}

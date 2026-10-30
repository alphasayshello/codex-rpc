// Node 25.5+ offers --build-sea; the runtime itself still supports Node 18+.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (
  !execFileSync(process.execPath, ["--help"], { encoding: "utf8" }).includes(
    "--build-sea",
  )
)
  throw Error("SEA builds require Node 25.5+ (normal CLI supports Node 18+)");
fs.mkdirSync("dist", { recursive: true });
const files = {};
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(name);
    else
      files[name.replaceAll(path.sep, "/")] = fs
        .readFileSync(name)
        .toString("base64");
  }
}
for (const dir of ["bin", "src", "web", "assets"]) collect(dir);
files["package.json"] = fs.readFileSync("package.json").toString("base64");
files["sea-launcher.cjs"] = Buffer.from(
  "import(require('node:url').pathToFileURL(process.argv[1]).href).catch(e=>{console.error(e);process.exitCode=1;});",
).toString("base64");
const archive = JSON.stringify(files),
  digest = createHash("sha256").update(archive).digest("hex").slice(0, 16);
fs.writeFileSync("dist/runtime.json", archive);
fs.writeFileSync(
  "dist/boot.cjs",
  `const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),url=require('node:url'),sea=require('node:sea');
const archive=JSON.parse(sea.getAsset('runtime','utf8'));
const base=path.join(process.env.CODEX_RPC_HOME||path.join(os.homedir(),'.codex-rpc'),'sea-runtime','${digest}');
fs.mkdirSync(base,{recursive:true,mode:0o700});
for(const [name,data]of Object.entries(archive)){const target=path.join(base,name);if(!fs.existsSync(target)){fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,Buffer.from(data,'base64'),{mode:0o600});}}
let args=process.argv.slice(2),entry=path.join(base,'bin/codex-rpc.js');
if(args[0]&&path.isAbsolute(args[0])&&args[0].endsWith('.js')&&fs.existsSync(args[0]))entry=args.shift();
process.env.CODEX_RPC_SEA='1';process.argv=[process.execPath,entry,...args];
require('node:module').createRequire(path.join(base,'package.json'))(path.join(base,'sea-launcher.cjs'));
`,
);
const output = path.resolve(
  "dist",
  process.platform === "win32" ? "codex-rpc.exe" : "codex-rpc",
);
fs.writeFileSync(
  "dist/sea-config.json",
  JSON.stringify({
    main: path.resolve("dist/boot.cjs"),
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { runtime: path.resolve("dist/runtime.json") },
  }),
);
execFileSync(process.execPath, ["--build-sea=dist/sea-config.json"], {
  stdio: "inherit",
});
if (process.platform === "darwin")
  execFileSync("codesign", ["--force", "--sign", "-", output], {
    stdio: "inherit",
  });
fs.chmodSync(output, 0o755);
console.log(output);

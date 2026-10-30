import fs from "node:fs";
import { execFileSync } from "node:child_process";
function walk(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + d.name;
    if (d.isDirectory() && d.name !== "node_modules") walk(p);
    else if (p.endsWith(".js") || p.endsWith(".cjs"))
      execFileSync(process.execPath, ["--check", p], { stdio: "inherit" });
  }
}
for (const dir of ["src", "bin", "web", "test", "scripts", "electron"])
  walk(dir);
console.log("JavaScript syntax checked.");

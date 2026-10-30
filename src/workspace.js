import fs from "node:fs";
import path from "node:path";
// Read only Git metadata. Never launch git from an event hook or retain cwd.
export function workspaceBranch(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  try {
    let directory = cwd;
    for (let level = 0; level < 16; level++) {
      const marker = path.join(directory, ".git");
      if (fs.existsSync(marker)) {
        let gitdir = marker;
        if (fs.statSync(marker).isFile()) {
          const match = /^gitdir: (.+)\r?$/m.exec(fs.readFileSync(marker, "utf8").slice(0, 4096));
          if (!match) return null;
          gitdir = path.resolve(directory, match[1]);
        }
        const head = fs.readFileSync(path.join(gitdir, "HEAD"), "utf8").slice(0, 512).trim();
        if (head.startsWith("ref: refs/heads/")) {
          const branch = head.slice(16);
          return branch && !/[\x00-\x20\x7f]/.test(branch) ? branch.slice(0, 80) : null;
        }
        return /^[a-f0-9]{40,64}$/i.test(head) ? `detached@${head.slice(0, 7)}` : null;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {}
  return null;
}

// Preserve TAP and expose failure diagnostics as public GitHub annotations.
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], {
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
if (result.status !== 0) {
  const text = (result.stdout || "") + "\n" + (result.stderr || "");
  for (const block of text
    .split(/(?=^# Subtest:)/m)
    .filter((x) => /^not ok /m.test(x))) {
    const escaped = block
      .slice(0, 16000)
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    console.log(`::error title=Node test failed::${escaped}`);
  }
}
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

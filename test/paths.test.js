import { test } from "node:test";
import assert from "node:assert/strict";
import { presenceFilePath } from "../src/paths.js";

test("presence filenames keep workspace context without home, drive or share prefixes", () => {
  for (const [input, project, expected] of [
    ["/Users/bamber/codexrpc/ok.ts", "codexrpc", "codexrpc/ok.ts"],
    ["/home/alice/codexrpc/src/ok.ts", "codexrpc", "codexrpc/src/ok.ts"],
    ["C:\\Users\\Alice\\CodexRPC\\src\\ok.ts", "codexrpc", "codexrpc/src/ok.ts"],
    ["C:\\Users\\Alice\\repo\\new\\readme.md", "repo", "repo/new/readme.md"],
    ["\\\\private-server\\share\\codexrpc\\src\\ok.ts", "codexrpc", "codexrpc/src/ok.ts"],
    ["src/ok.ts", "codexrpc", "codexrpc/src/ok.ts"],
    ["codexrpc/src/ok.ts", "codexrpc", "codexrpc/src/ok.ts"],
    ["./src/../ok.ts", "codexrpc", "codexrpc/ok.ts"],
    ["/Users/alice/another-project/secret.ts", "codexrpc", "secret.ts"],
    ["/Users/alice/another-project/secret.ts", undefined, "secret.ts"],
    ["/Users/alice/codexrpc/../../private/secret.ts", "codexrpc", "secret.ts"],
    ["../../private/secret.ts", "codexrpc", "secret.ts"],
    ["src/ok.ts", "/Users/alice/project", "src/ok.ts"],
    ["/private/ok.ts", "project", "ok.ts"],
    ["src/ok.ts", undefined, "src/ok.ts"],
    ["C:", "codexrpc", null],
    ["..", "codexrpc", null],
    ["/", "codexrpc", null],
    ["bad\nname.ts", "codexrpc", null],
    [null, "codexrpc", null],
  ]) assert.equal(presenceFilePath(input, project), expected, String(input));
});

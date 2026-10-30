import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { replaceFile } from "../src/atomic.js";
import { sandbox } from "./helpers.js";
test("Windows retries transient replacement locks while preserving the old complete snapshot", (t) => {
  const { temp } = sandbox(t),
    source = path.join(temp, "next.json"),
    target = path.join(temp, "state.json");
  fs.writeFileSync(source, '{"version":2}');
  fs.writeFileSync(target, '{"version":1}');
  let calls = 0;
  const waits = [];
  replaceFile(source, target, {
    platform: "win32",
    wait: (n) => waits.push(n),
    rename: (a, b) => {
      assert.equal(JSON.parse(fs.readFileSync(b)).version, 1);
      if (calls++ < 2)
        throw Object.assign(Error("handle busy"), { code: "EPERM" });
      fs.renameSync(a, b);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.equal(JSON.parse(fs.readFileSync(target)).version, 2);
  assert.equal(fs.existsSync(source), false);
});
test("replacement retries are bounded and non-contention errors never wait", () => {
  let calls = 0;
  const waits = [];
  assert.throws(
    () =>
      replaceFile("from", "to", {
        platform: "win32",
        wait: (n) => waits.push(n),
        rename: () => {
          calls++;
          throw Object.assign(Error("locked"), { code: "EBUSY" });
        },
      }),
    /locked/,
  );
  assert.equal(calls, 8);
  assert.equal(
    waits.reduce((n, v) => n + v, 0),
    71,
  );
  for (const platform of ["darwin", "linux", "win32"]) {
    let count = 0;
    assert.throws(
      () =>
        replaceFile("from", "to", {
          platform,
          wait: () => assert.fail("must not wait"),
          rename: () => {
            count++;
            throw Object.assign(Error("missing"), { code: "ENOENT" });
          },
        }),
      /missing/,
    );
    assert.equal(count, 1);
  }
});

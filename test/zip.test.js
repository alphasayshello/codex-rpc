import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip } from "../src/zip.js";

test("hosting downloads produce deterministic ZIP entries with correct CRC and directory offsets", () => {
  const entries = [{ name: "writing.gif", data: Buffer.from("123456789") }, { name: "manifest.json", data: "{}" }];
  const zip = createZip(entries);
  assert.deepEqual(zip, createZip(entries));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  assert.equal(zip.readUInt32LE(18), 9);
  const end = zip.length - 22, central = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  assert.equal(zip.readUInt32LE(central), 0x02014b50);
  assert.equal(zip.readUInt32LE(central + 42), 0);
  assert.equal(zip.subarray(30, 41).toString(), "writing.gif");
  for (const name of ["../secret", "folder/file.gif", "\\outside", "..", "", "<svg>"])
    assert.throws(() => createZip([{ name, data: "" }]), /entry name/);
  assert.throws(() => createZip([{ name: "a.gif", data: "" }, { name: "a.gif", data: "" }]), /entry name/);
});

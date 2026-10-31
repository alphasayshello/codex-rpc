// Export-only ZIP container. No archive extraction, compression or dependencies.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function createZip(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 128) throw Error("Invalid ZIP entry count");
  const names = new Set(), local = [], central = [];
  let offset = 0, total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(entry.name) || names.has(entry.name))
      throw Error("Invalid ZIP entry name");
    names.add(entry.name);
    const data = typeof entry.data === "string" ? Buffer.from(entry.data) : entry.data;
    if (!Buffer.isBuffer(data) || data.length > 32 * 1024 * 1024) throw Error("ZIP entry too large or invalid");
    total += data.length;
    if (total > 64 * 1024 * 1024) throw Error("ZIP download too large");
    const name = Buffer.from(entry.name), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42); central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

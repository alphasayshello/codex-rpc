import fs from "node:fs";
// Windows can briefly deny replacement while another process holds a handle.
// Retry only that exceptional case; ordinary writes and POSIX never wait.
export function replaceFile(
  source,
  target,
  {
    platform = process.platform,
    rename = fs.renameSync,
    wait = (milliseconds) =>
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        milliseconds,
      ),
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return rename(source, target);
    } catch (error) {
      if (
        platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
        attempt === 7
      )
        throw error;
      wait(Math.min(20, 2 ** attempt));
    }
  }
}

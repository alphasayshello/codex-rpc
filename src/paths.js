// Hotspots are metadata, never a place to retain fragments of a command or patch.
// Be conservative: unusual filenames are omitted rather than misread as source.
export function safeFilePath(value) {
  if (typeof value !== "string" || !value || value.length > 1024) return null;
  if (value !== value.trim() || /[\x00-\x1f\x7f]|\\[nr]/.test(value)) return null;
  return /^[\p{L}\p{N} ._/@:+\-\\]+$/u.test(value) ? value : null;
}

// Discord is public output even when the local cache contains absolute paths.
// Never infer an unknown workspace from a user's home or drive directories.
export function presenceFilePath(value, project) {
  if (typeof value !== "string") return null;
  const portable = value.replaceAll("\\", "/");
  if (!safeFilePath(portable)) return null;
  const absolute = /^(?:\/|[a-z]:|~(?:\/|$))/i.test(portable);
  const workspace = typeof project === "string" && safeFilePath(project) &&
    !/[\\/:]/.test(project) && ![".", ".."].includes(project) ? project : null;
  const parts = [];
  let escaped = false;
  for (const part of portable.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length) parts.pop(); else escaped = true; }
    else parts.push(part);
  }
  if (!parts.length || /^[a-z]:$/i.test(parts.at(-1))) return null;
  if (escaped) return parts.at(-1);
  if (absolute) {
    // Windows paths are case-insensitive, including UNC shares.
    const fold = (part) => /^(?:[a-z]:|\/\/)/i.test(portable) ? part.toLowerCase() : part;
    const index = workspace ? parts.map(fold).lastIndexOf(fold(workspace)) : -1;
    return index >= 0 ? [workspace, ...parts.slice(index + 1)].join("/") : parts.at(-1);
  }
  if (!workspace) return parts.join("/");
  return (parts[0] === workspace ? parts : [workspace, ...parts]).join("/");
}

// Hotspots are metadata, never a place to retain fragments of a command or patch.
// Be conservative: unusual filenames are omitted rather than misread as source.
export function safeFilePath(value) {
  if (typeof value !== "string" || !value || value.length > 1024) return null;
  if (value !== value.trim() || /[\x00-\x1f\x7f]|\\[nr]/.test(value)) return null;
  return /^[\p{L}\p{N} ._/@:+\-\\]+$/u.test(value) ? value : null;
}

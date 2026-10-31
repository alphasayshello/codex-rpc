import { isIP } from "node:net";

export function normalizePetBaseUrl(value) {
  if (value === "" || value === undefined) return "";
  const message = "Pet base URL must be a public HTTPS folder URL without credentials, query strings or fragments";
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw Error(message);
  let url;
  try { url = new URL(value); } catch { throw Error(message); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port ||
    !hostname.includes(".") || isIP(hostname.replace(/^\[|\]$/g, "")) ||
    /(?:^|\.)(?:localhost|local|internal|onion)$/.test(hostname)) throw Error(message);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

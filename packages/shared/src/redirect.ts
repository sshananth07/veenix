/**
 * Where to send someone after sign-in: a path on this site, or "/".
 * Parsed the way the browser will parse it, so "//evil.com", "/\evil.com" and "/<tab>/evil.com" can't leave the site.
 */
export function safeReturnPath(next: string | null | undefined, origin: string): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

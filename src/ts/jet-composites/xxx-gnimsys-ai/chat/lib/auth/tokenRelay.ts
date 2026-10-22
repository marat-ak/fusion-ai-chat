import { Audience, AuthError } from "./AuthFetch";

export function relayUrl(origin: string, pod: string, audience: Audience): string {
  const base = `${origin}/fscmRestApi/tokenrelay`;
  if (audience === "rest") return base;
  return `${base}?scopesfq=${encodeURIComponent(`urn:opc:resource:fusion:${pod}:${audience}/`)}`;
}

// The anti-CSRF token, fetched once per origin from /fscmRestApi/anticsrf: every chat instance on the page (and any
// other reader) gets the value fetched first. A failed fetch caches nothing.
const xsrfByOrigin = new Map<string, string>();

export function clearXsrfCache(): void {
  xsrfByOrigin.clear();
}

export async function fetchXsrfToken(origin: string, fetchImpl: typeof fetch): Promise<string> {
  const cached = xsrfByOrigin.get(origin);
  if (cached !== undefined) return cached;
  const res = await fetchImpl(`${origin}/fscmRestApi/anticsrf`, { credentials: "same-origin", cache: "no-cache", redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new AuthError("relogin", res.status || undefined);
  if (res.status === 401) throw new AuthError("unauthorized", 401);
  if (!res.ok) throw new AuthError("invalid", res.status, "xsrf-unavailable");
  let tok: unknown;
  try {
    tok = (JSON.parse(await res.text()) as { xsrftoken?: unknown } | null)?.xsrftoken;
  } catch {
    throw new AuthError("invalid", res.status, "xsrf-unavailable");
  }
  if (typeof tok !== "string" || !tok) throw new AuthError("invalid", res.status, "xsrf-unavailable");
  xsrfByOrigin.set(origin, tok);
  return tok;
}

export function tokenExpiry(jwt: string): { exp: number; iat: number } | null {
  try {
    const seg = jwt.split(".")[1];
    if (!seg) return null;
    let b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const json = decodeURIComponent(
      Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    const p = JSON.parse(json);
    if (typeof p?.exp !== "number" || typeof p?.iat !== "number") return null;
    return { exp: p.exp, iat: p.iat };
  } catch {
    return null;
  }
}

/** Oracle's validity rule (seconds): now - min(now - iat, 100) <= exp - 100. */
export class TokenCache {
  private m = new Map<Audience, { token: string; exp: number; iat: number }>();
  private now: () => number;
  constructor(now: () => number) { this.now = now; }
  get(aud: Audience): string | undefined {
    const e = this.m.get(aud);
    if (!e) return undefined;
    const n = this.now();
    return n - Math.min(n - e.iat, 100) <= e.exp - 100 ? e.token : undefined;
  }
  set(aud: Audience, token: string): void {
    const x = tokenExpiry(token);
    if (!x) throw new AuthError("invalid", undefined, "token-undecodable");
    this.m.set(aud, { token, exp: x.exp, iat: x.iat });
  }
}

export async function fetchRelayToken(url: string, xsrf: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { "x-xsrf-token": xsrf },
    redirect: "manual",
    credentials: "same-origin",
  });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new AuthError("relogin", res.status || undefined);
  if (res.status === 401) throw new AuthError("unauthorized", 401);
  if (!res.ok) throw new AuthError("relogin", res.status);
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw new AuthError("relogin");
  }
  const tok = (body as { access_token?: unknown } | null)?.access_token;
  if (typeof tok !== "string" || !tok) throw new AuthError("relogin");
  return tok;
}

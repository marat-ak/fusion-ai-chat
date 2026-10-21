import { Audience, AuthError, AuthFetch } from "./AuthFetch";
import { TokenCache, fetchRelayToken, readXsrfToken, relayUrl } from "./tokenRelay";

export class FusionShellAuthFetch implements AuthFetch {
  private cache: TokenCache;
  private xsrf: string | undefined;
  private readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  private deps: { pod: string; document: Document; origin?: string; fetchImpl?: typeof fetch; now?: () => number };

  constructor(deps: { pod: string; document: Document; origin?: string; fetchImpl?: typeof fetch; now?: () => number }) {
    this.deps = deps;
    this.cache = new TokenCache(deps.now ?? (() => Math.floor(Date.now() / 1000)));
    this.origin = deps.origin ?? globalThis.location?.origin ?? "";
    this.fetchImpl = deps.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  private async token(aud: Audience): Promise<string> {
    const cached = this.cache.get(aud);
    if (cached) return cached;
    if (this.xsrf === undefined) this.xsrf = readXsrfToken(this.deps.document);
    const tok = await fetchRelayToken(relayUrl(this.origin, this.deps.pod, aud), this.xsrf, this.fetchImpl);
    this.cache.set(aud, tok); // throws AuthError("invalid") when expiry undecodable
    if (!this.cache.get(aud)) throw new AuthError("invalid");
    return tok;
  }

  async fetch(audience: Audience, url: string, init?: RequestInit): Promise<Response> {
    const tok = await this.token(audience);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${tok}`);
    headers.set("Cache-Control", "no-cache");
    return this.fetchImpl(url, { ...init, headers, credentials: "same-origin" });
  }
}

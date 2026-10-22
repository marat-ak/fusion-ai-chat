import { resolveOrigin } from "../origin";
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
    try {
      this.origin = resolveOrigin(deps.origin);
    } catch (err) {
      const e = new AuthError("invalid");
      e.message = (err as Error).message;
      throw e;
    }
    this.fetchImpl = deps.fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  private inflight = new Map<Audience, Promise<string>>();

  private token(aud: Audience): Promise<string> {
    const cached = this.cache.get(aud);
    if (cached) return Promise.resolve(cached);
    const pending = this.inflight.get(aud);
    if (pending) return pending;
    const p = this.mint(aud).finally(() => { this.inflight.delete(aud); });
    this.inflight.set(aud, p);
    return p;
  }

  private async mint(aud: Audience): Promise<string> {
    if (this.xsrf === undefined) this.xsrf = readXsrfToken(this.deps.document);
    const tok = await fetchRelayToken(relayUrl(this.origin, this.deps.pod, aud), this.xsrf, this.fetchImpl);
    this.cache.set(aud, tok); // throws AuthError("invalid", reason "token-undecodable") when the expiry is unreadable
    // A freshly minted token already outside the validity window indicates clock skew between browser and pod, not a bad token.
    if (!this.cache.get(aud)) throw new AuthError("invalid", undefined, "clock-skew");
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

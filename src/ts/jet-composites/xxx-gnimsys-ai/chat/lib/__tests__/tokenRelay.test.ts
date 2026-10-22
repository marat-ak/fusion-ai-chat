import { relayUrl, fetchXsrfToken, clearXsrfCache, tokenExpiry, TokenCache, fetchRelayToken } from "../auth/tokenRelay";
import { AuthError } from "../auth/AuthFetch";
import { makeJwt, fakeResponse } from "./helpers.auth";

const O = "https://pod.example.com";

test("relayUrl_for_each_audience", () => {
  const sc = (a: string) => encodeURIComponent(`urn:opc:resource:fusion:POD1:${a}/`);
  expect(relayUrl(O, "POD1", "fusion-ai")).toBe(`${O}/fscmRestApi/tokenrelay?scopesfq=${sc("fusion-ai")}`);
  expect(relayUrl(O, "POD1", "boss")).toBe(`${O}/fscmRestApi/tokenrelay?scopesfq=${sc("boss")}`);
  expect(relayUrl(O, "POD1", "rest")).toBe(`${O}/fscmRestApi/tokenrelay`);
});

beforeEach(() => clearXsrfCache());

test("fetchXsrfToken_returns_token_and_caches_per_origin", async () => {
  const calls: Array<[string, RequestInit]> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return fakeResponse(JSON.stringify({ xsrftoken: "tok-" + calls.length }));
  }) as unknown as typeof fetch;
  expect(await fetchXsrfToken(O, fetchImpl)).toBe("tok-1");
  expect(calls[0][0]).toBe(`${O}/fscmRestApi/anticsrf`);
  expect(calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-cache", redirect: "manual" });
  expect(await fetchXsrfToken(O, fetchImpl)).toBe("tok-1");
  expect(calls).toHaveLength(1);
  expect(await fetchXsrfToken("https://other.example.com", fetchImpl)).toBe("tok-2");
  expect(calls).toHaveLength(2);
});

test("fetchXsrfToken_non2xx_is_xsrf_unavailable", async () => {
  const mk = (body: string, status: number) => (async () => fakeResponse(body, { status })) as unknown as typeof fetch;
  await expect(fetchXsrfToken(O, mk("{}", 500))).rejects.toMatchObject({ kind: "invalid", status: 500, reason: "xsrf-unavailable" });
  await expect(fetchXsrfToken(O, mk("<html>", 200))).rejects.toMatchObject({ kind: "invalid", reason: "xsrf-unavailable" });
  await expect(fetchXsrfToken(O, mk("{}", 200))).rejects.toMatchObject({ kind: "invalid", reason: "xsrf-unavailable" });
  await expect(fetchXsrfToken(O, mk('{"xsrftoken":""}', 200))).rejects.toMatchObject({ kind: "invalid", reason: "xsrf-unavailable" });
  await expect(fetchXsrfToken(O, mk("{}", 401))).rejects.toMatchObject({ kind: "unauthorized", status: 401 });
  // A failed fetch caches nothing.
  expect(await fetchXsrfToken(O, mk('{"xsrftoken":"ok"}', 200))).toBe("ok");
});

test("fetchXsrfToken_redirect_is_relogin", async () => {
  const f302 = (async () => fakeResponse("", { status: 302 })) as unknown as typeof fetch;
  await expect(fetchXsrfToken(O, f302)).rejects.toMatchObject({ kind: "relogin", status: 302 });
  const opaque = (async () => ({ type: "opaqueredirect", status: 0, ok: false, text: async () => "" })) as unknown as typeof fetch;
  await expect(fetchXsrfToken(O, opaque)).rejects.toMatchObject({ kind: "relogin" });
});

test("tokenExpiry_decodes_and_rejects_garbage", () => {
  expect(tokenExpiry(makeJwt(2000, 1000))).toEqual({ exp: 2000, iat: 1000 });
  expect(tokenExpiry("not-a-jwt")).toBeNull();
});

test("TokenCache_expires_with_skew", () => {
  const now = 1000;
  const c = new TokenCache(() => now);
  const good = makeJwt(now + 150, now);
  c.set("rest", good);
  expect(c.get("rest")).toBe(good);
  const c2 = new TokenCache(() => now);
  c2.set("rest", makeJwt(now + 90, now));
  expect(c2.get("rest")).toBeUndefined();
});

test("TokenCache_set_undecodable_is_invalid_with_reason", () => {
  const c = new TokenCache(() => 1000);
  expect(() => c.set("rest", "opaque")).toThrow(expect.objectContaining({ kind: "invalid", reason: "token-undecodable" }));
});

async function kindOf(p: Promise<unknown>): Promise<AuthError> {
  try { await p; } catch (e) { return e as AuthError; }
  throw new Error("expected rejection");
}

test("relay_html_is_relogin", async () => {
  const f = (async () => fakeResponse("<html/>", { contentType: "text/html" })) as unknown as typeof fetch;
  const e = await kindOf(fetchRelayToken("u", "x", f));
  expect(e).toBeInstanceOf(AuthError);
  expect(e.kind).toBe("relogin");
});

test("relay_401_is_unauthorized", async () => {
  const f = (async () => fakeResponse("", { status: 401 })) as unknown as typeof fetch;
  const e = await kindOf(fetchRelayToken("u", "x", f));
  expect(e.kind).toBe("unauthorized");
  expect(e.status).toBe(401);
});

test("relay_redirect_is_relogin", async () => {
  const f = (async () => fakeResponse("", { status: 0, type: "opaqueredirect" })) as unknown as typeof fetch;
  expect((await kindOf(fetchRelayToken("u", "x", f))).kind).toBe("relogin");
});

test("relay_sends_xsrf_and_manual_redirect", async () => {
  const calls: Array<[string, RequestInit]> = [];
  const tok = makeJwt(5000, 1000);
  const f = (async (u: string, i: RequestInit) => { calls.push([u, i]); return fakeResponse(JSON.stringify({ access_token: tok })); }) as unknown as typeof fetch;
  expect(await fetchRelayToken("u1", "xs", f)).toBe(tok);
  expect(calls[0][0]).toBe("u1");
  expect(calls[0][1].redirect).toBe("manual");
  expect((calls[0][1].headers as Record<string, string>)["x-xsrf-token"]).toBe("xs");
});

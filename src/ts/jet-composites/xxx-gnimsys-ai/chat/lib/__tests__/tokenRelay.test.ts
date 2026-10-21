import { relayUrl, readXsrfToken, tokenExpiry, TokenCache, fetchRelayToken } from "../auth/tokenRelay";
import { AuthError } from "../auth/AuthFetch";
import { makeJwt, fakeResponse } from "./helpers.auth";

const O = "https://pod.example.com";

test("relayUrl_for_each_audience", () => {
  const sc = (a: string) => encodeURIComponent(`urn:opc:resource:fusion:POD1:${a}/`);
  expect(relayUrl(O, "POD1", "fusion-ai")).toBe(`${O}/fscmRestApi/tokenrelay?scopesfq=${sc("fusion-ai")}`);
  expect(relayUrl(O, "POD1", "boss")).toBe(`${O}/fscmRestApi/tokenrelay?scopesfq=${sc("boss")}`);
  expect(relayUrl(O, "POD1", "rest")).toBe(`${O}/fscmRestApi/tokenrelay`);
});

test("readXsrfToken_reads_and_removes_node", () => {
  document.body.innerHTML = '<div id="fndsectkn" data="tok-1"></div>';
  expect(readXsrfToken(document)).toBe("tok-1");
  expect(document.getElementById("fndsectkn")).toBeNull();
});

test("readXsrfToken_throws_when_missing", () => {
  document.body.innerHTML = "";
  expect(() => readXsrfToken(document)).toThrow(AuthError);
  try { readXsrfToken(document); } catch (e) { expect((e as AuthError).kind).toBe("invalid"); }
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

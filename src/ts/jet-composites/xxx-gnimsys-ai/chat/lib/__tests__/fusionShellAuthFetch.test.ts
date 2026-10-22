import { FusionShellAuthFetch } from "../auth/FusionShellAuthFetch";
import { AuthError } from "../auth/AuthFetch";
import { clearXsrfCache } from "../auth/tokenRelay";
import { makeJwt, fakeResponse } from "./helpers.auth";

const XSRF_BODY = JSON.stringify({ xsrftoken: "xs" });
beforeEach(() => clearXsrfCache());

const O = "https://pod.example.com";

test("fetch_adds_bearer_and_caches_per_audience", async () => {
  const now = 1000;
  const relayCalls: string[] = [];
  const xsrfCalls: string[] = [];
  const relayXsrf: Array<string | undefined> = [];
  const apiCalls: Array<[string, RequestInit]> = [];
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (url.includes("/fscmRestApi/anticsrf")) { xsrfCalls.push(url); return fakeResponse(XSRF_BODY); }
    if (url.includes("/fscmRestApi/tokenrelay")) {
      relayCalls.push(url);
      relayXsrf.push((init.headers as Record<string, string>)["x-xsrf-token"]);
      return fakeResponse(JSON.stringify({ access_token: makeJwt(now + 3600, now), expires_in: 3600, token_type: "Bearer", principal: "u", n: ++n }));
    }
    apiCalls.push([url, init]);
    return fakeResponse("{}", { status: 401 });
  }) as unknown as typeof fetch;
  const af = new FusionShellAuthFetch({ pod: "POD1", origin: O, fetchImpl, now: () => now });

  const r1 = await af.fetch("fusion-ai", `${O}/api/a`, { headers: { "X-Mine": "1" } });
  expect(r1.status).toBe(401); // surfaced untouched, no retry
  await af.fetch("fusion-ai", `${O}/api/b`);
  expect(relayCalls).toHaveLength(1);
  await af.fetch("boss", `${O}/api/c`);
  expect(relayCalls).toHaveLength(2);
  expect(xsrfCalls).toEqual([`${O}/fscmRestApi/anticsrf`]); // one anticsrf call across audiences
  expect(relayXsrf).toEqual(["xs", "xs"]);
  expect(apiCalls).toHaveLength(3);

  const h = apiCalls[0][1].headers as Headers;
  expect(h.get("Authorization")).toMatch(/^Bearer .+\..+\..+$/);
  expect(h.get("Cache-Control")).toBe("no-cache");
  expect(h.get("X-Mine")).toBe("1");
  expect(apiCalls[0][1].credentials).toBe("same-origin");
});

test("fetch_throws_when_token_expiry_undecodable", async () => {
  const fetchImpl = (async (url: string) => url.includes("/anticsrf") ? fakeResponse(XSRF_BODY) : fakeResponse(JSON.stringify({ access_token: "opaque" }))) as unknown as typeof fetch;
  const af = new FusionShellAuthFetch({ pod: "P", origin: O, fetchImpl, now: () => 1 });
  await expect(af.fetch("rest", `${O}/x`)).rejects.toMatchObject({ kind: "invalid", reason: "token-undecodable" });
  await expect(af.fetch("rest", `${O}/x`)).rejects.toBeInstanceOf(AuthError);
});

test("fetch_throws_clock_skew_when_fresh_token_outside_window", async () => {
  const now = 1000;
  // Decodable, but already within the 100 s skew margin of its expiry at this browser clock.
  const fetchImpl = (async (url: string) => url.includes("/anticsrf") ? fakeResponse(XSRF_BODY) : fakeResponse(JSON.stringify({ access_token: makeJwt(now + 90, now) }))) as unknown as typeof fetch;
  const af = new FusionShellAuthFetch({ pod: "P", origin: O, fetchImpl, now: () => now });
  await expect(af.fetch("rest", `${O}/x`)).rejects.toMatchObject({ kind: "invalid", reason: "clock-skew" });
});

test("anticsrf_failure_is_invalid_with_reason_and_not_remembered", async () => {
  let fail = true;
  const fetchImpl = (async (url: string) => {
    if (url.includes("/anticsrf")) return fail ? fakeResponse("{}", { status: 500 }) : fakeResponse(XSRF_BODY);
    return fakeResponse(JSON.stringify({ access_token: makeJwt(5000, 1000) }));
  }) as unknown as typeof fetch;
  const af = new FusionShellAuthFetch({ pod: "P", origin: O, fetchImpl, now: () => 1000 });
  await expect(af.fetch("rest", `${O}/x`)).rejects.toMatchObject({ kind: "invalid", status: 500, reason: "xsrf-unavailable" });
  fail = false;
  await expect(af.fetch("rest", `${O}/x`)).resolves.toBeDefined();
});

test("fetch_parallel_calls_same_audience_mint_once", async () => {
  const now = 1000;
  let relays = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const auths: Array<string | null> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (url.includes("/fscmRestApi/anticsrf")) return fakeResponse(XSRF_BODY);
    if (url.includes("/fscmRestApi/tokenrelay")) {
      relays++;
      await gate;
      return fakeResponse(JSON.stringify({ access_token: makeJwt(now + 3600, now) }));
    }
    auths.push((init.headers as Headers).get("Authorization"));
    return fakeResponse("{}");
  }) as unknown as typeof fetch;
  const af = new FusionShellAuthFetch({ pod: "P", origin: O, fetchImpl, now: () => now });
  const a = af.fetch("fusion-ai", `${O}/a`);
  const b = af.fetch("fusion-ai", `${O}/b`);
  release();
  await Promise.all([a, b]);
  expect(relays).toBe(1);
  expect(auths).toHaveLength(2);
  expect(auths[0]).toBe(auths[1]);
  expect(auths[0]).toMatch(/^Bearer /);
});

test("constructor_throws_without_origin_or_location", () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
  try {
    expect(() => new FusionShellAuthFetch({ pod: "P", fetchImpl: (async () => fakeResponse("{}")) as unknown as typeof fetch }))
      .toThrow("origin unavailable");
  } finally {
    if (desc) Object.defineProperty(globalThis, "location", desc);
  }
});

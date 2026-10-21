// Test helpers (not a test file): fake JWTs and minimal Response objects (jsdom may lack Response).
export function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function makeJwt(exp: number, iat: number): string {
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ exp, iat }))}.sig`;
}
export function fakeResponse(body: string, opts: { status?: number; type?: string; contentType?: string } = {}): Response {
  const status = opts.status ?? 200;
  const headers = new Map<string, string>([["content-type", opts.contentType ?? "application/json"]]);
  return {
    status,
    ok: status >= 200 && status < 300,
    type: opts.type ?? "basic",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => body,
  } as unknown as Response;
}

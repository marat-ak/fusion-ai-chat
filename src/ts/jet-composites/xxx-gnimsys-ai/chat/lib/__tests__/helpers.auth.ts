// Test helpers (not a test file): fake JWTs and minimal Response objects (jsdom may lack Response).
export function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function makeJwt(exp: number, iat: number): string {
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ exp, iat }))}.sig`;
}
export function fakeResponse(body: string, opts: { status?: number; type?: string; contentType?: string; headers?: Record<string, string> } = {}): Response {
  const status = opts.status ?? 200;
  const headers = new Map<string, string>([["content-type", opts.contentType ?? "application/json"]]);
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k.toLowerCase(), v);
  return {
    status,
    ok: status >= 200 && status < 300,
    type: opts.type ?? "basic",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => body,
  } as unknown as Response;
}
/** fakeResponse plus a `body` ReadableStream of the given chunks (needs the node Jest env for ReadableStream/TextEncoder). */
export function streamResponse(chunks: string[], opts: { status?: number; open?: boolean } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!opts.open) c.close();
    },
  });
  return Object.assign(fakeResponse(chunks.join(""), { status: opts.status, contentType: "text/event-stream" }), { body });
}

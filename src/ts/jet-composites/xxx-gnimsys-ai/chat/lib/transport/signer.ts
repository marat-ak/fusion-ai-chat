export const H_CHECK = "X-Ora-Ai-Api-V2-Check", H_VERSION = "X-Ora-Ai-Api-V2-Check-Version", H_TIMESTAMP = "X-Ora-Ai-Api-V2-Timestamp";

/** vendor H1 */
export function hashCode(s: string): number {
  let t = 0;
  for (let n = 0; n < s.length; n += 1) t = (t * 31 + s.charCodeAt(n) * (n + 7)) % 104729;
  return t;
}

/** vendor z1 */
export function signingKey(version: string, ts: number): string {
  const n = hashCode(version), o = 30 + (n % 17), r = Math.floor((ts + n) / o), a = Math.floor(ts / 86400), i = Math.floor(ts / 604800);
  const s = (a * ((n % 23) + 3) + n) % 104729, c = (ts % (9973 + (n % 29))) + (n % 541);
  return [version, n.toString(36), i + (n % 97), s.toString(36), r, c.toString(36)].join("|");
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** vendor W1 + B1: HMAC-SHA256 over the UTF-8 payload with the UTF-8 key, base64url without padding. */
export async function hmacCheck(payload: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await globalThis.crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", k, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function signedHeaders(message: string, version: string, ts: number = Math.floor(Date.now() / 1000)): Promise<Record<string, string>> {
  return {
    [H_VERSION]: version,
    [H_TIMESTAMP]: String(ts),
    [H_CHECK]: await hmacCheck(message, signingKey(version, ts)),
  };
}

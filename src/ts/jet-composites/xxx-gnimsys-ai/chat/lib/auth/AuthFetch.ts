export type Audience = "fusion-ai" | "boss" | "rest";

export interface AuthFetch {
  fetch(audience: Audience, url: string, init?: RequestInit): Promise<Response>;
}

export type AuthErrorKind = "relogin" | "unauthorized" | "invalid";
/** Why auth is unavailable (kind "invalid"): the anti-CSRF token request failed, a relay token without a readable expiry, or a fresh token already expired at the browser clock. */
export type AuthReason = "xsrf-unavailable" | "token-undecodable" | "clock-skew";

export class AuthError extends Error {
  kind: AuthErrorKind;
  status?: number;
  reason?: AuthReason;
  constructor(kind: AuthErrorKind, status?: number, reason?: AuthReason) {
    super(`relay ${kind}${status ? " " + status : ""}`);
    this.name = "AuthError";
    this.kind = kind;
    this.status = status;
    this.reason = reason;
  }
}

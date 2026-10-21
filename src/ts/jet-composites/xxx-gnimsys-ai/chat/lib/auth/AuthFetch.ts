export type Audience = "fusion-ai" | "boss" | "rest";

export interface AuthFetch {
  fetch(audience: Audience, url: string, init?: RequestInit): Promise<Response>;
}

export class AuthError extends Error {
  kind: "relogin" | "unauthorized" | "invalid";
  status?: number;
  constructor(kind: "relogin" | "unauthorized" | "invalid", status?: number) {
    super(`relay ${kind}${status ? " " + status : ""}`);
    this.name = "AuthError";
    this.kind = kind;
    this.status = status;
  }
}

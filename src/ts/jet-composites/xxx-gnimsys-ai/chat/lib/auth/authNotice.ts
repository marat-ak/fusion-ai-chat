import type { AuthReason } from "./AuthFetch";

/** The auth banner for a failed auth state: its text, and whether a page reload can help. */
export function authNotice(state: "relogin" | "unauthorized" | "unavailable", reason?: AuthReason, status?: number): { text: string; reload: boolean } {
  switch (state) {
    case "relogin":
      return { text: "Session expired. Reload the page to sign in again.", reload: true };
    case "unauthorized":
      return { text: "Not authorized to use this agent.", reload: true };
    case "unavailable":
      switch (reason) {
        case "xsrf-unavailable":
          return { text: `Chat auth unavailable: anti-CSRF token request failed (HTTP ${status ?? "?"})`, reload: true };
        case "token-undecodable":
          return { text: "Chat auth unavailable: token could not be read", reload: true };
        case "clock-skew":
          return { text: "Chat auth unavailable: browser clock out of sync", reload: true };
        case undefined:
          return { text: "Chat auth unavailable", reload: true };
      }
  }
}

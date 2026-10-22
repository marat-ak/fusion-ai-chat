import type { AuthReason } from "./AuthFetch";

/** The auth banner for a failed auth state: its text, and whether a page reload can help. */
export function authNotice(state: "relogin" | "unauthorized" | "unavailable", reason?: AuthReason): { text: string; reload: boolean } {
  switch (state) {
    case "relogin":
      return { text: "Session expired. Reload the page to sign in again.", reload: true };
    case "unauthorized":
      return { text: "Not authorized to use this agent.", reload: true };
    case "unavailable":
      switch (reason) {
        // The page has no shell node: a reload brings back the same page.
        case "xsrf-missing":
          return { text: "Chat auth unavailable on this page: #fndsectkn not found", reload: false };
        case "token-undecodable":
          return { text: "Chat auth unavailable: token could not be read", reload: true };
        case "clock-skew":
          return { text: "Chat auth unavailable: browser clock out of sync", reload: true };
        case undefined:
          return { text: "Chat auth unavailable", reload: true };
      }
  }
}

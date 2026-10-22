import { authNotice } from "../auth/authNotice";

test("authNotice_texts_and_reload_per_state_and_reason", () => {
  expect(authNotice("relogin")).toEqual({ text: "Session expired. Reload the page to sign in again.", reload: true });
  expect(authNotice("unauthorized")).toEqual({ text: "Not authorized to use this agent.", reload: true });
  // A page without the shell's node does not gain one on reload: no Reload button.
  expect(authNotice("unavailable", "xsrf-missing")).toEqual({ text: "Chat auth unavailable on this page: #fndsectkn not found", reload: false });
  expect(authNotice("unavailable", "token-undecodable")).toEqual({ text: "Chat auth unavailable: token could not be read", reload: true });
  expect(authNotice("unavailable", "clock-skew")).toEqual({ text: "Chat auth unavailable: browser clock out of sync", reload: true });
});

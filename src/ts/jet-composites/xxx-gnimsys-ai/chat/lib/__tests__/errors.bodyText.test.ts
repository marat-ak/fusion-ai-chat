import { bodyTextOf } from "../errors";
import { EndpointError } from "../endpoints/EndpointFetch";
import { HistoryError } from "../history/HistoryStore";
import { AttachmentError } from "../files/OracleAttachmentService";

test("readable_text_of_an_http_failure_body", () => {
  expect(bodyTextOf(new EndpointError("http", "FUAI", "/api/fusion-ai/x", "m", 401, '{"state":"auth-required","detail":"Sign in to dev1 in the agent chat first."}')))
    .toBe("Sign in to dev1 in the agent chat first.");
  expect(bodyTextOf(new EndpointError("http", "BOSS", "/api/boss/x", "m", 401, { title: "Unauthorized" }))).toBe("Unauthorized");
  expect(bodyTextOf(new HistoryError(401, '{"detail":"go away"}'))).toBe("go away");
  expect(bodyTextOf(new AttachmentError("upload", 401, "<html><body>Login</body></html>"))).toBe("Login");
});

test("no_text_without_an_http_body", () => {
  expect(bodyTextOf(new EndpointError("http", "FUAI", "/api/fusion-ai/x", "m", 401, ""))).toBeUndefined();
  expect(bodyTextOf(new EndpointError("http", "FUAI", "/api/fusion-ai/x", "m", 401))).toBeUndefined();
  expect(bodyTextOf(new EndpointError("network", "FUAI", "/api/fusion-ai/x", "m"))).toBeUndefined();
  expect(bodyTextOf(new Error("x"))).toBeUndefined();
});

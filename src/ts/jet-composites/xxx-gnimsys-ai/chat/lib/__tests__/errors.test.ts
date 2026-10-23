import { errorDetail, historyFailureText, isRelogin, statusOf } from "../errors";
import { EndpointError } from "../endpoints/EndpointFetch";
import { AttachmentError } from "../files/OracleAttachmentService";
import { HistoryError } from "../history/HistoryStore";

test("a_fusion_error_on_200_is_reported_with_its_prefix_and_status", () => {
  // What ai-chat-error carries for a call answered 200 with an o:errorCode body.
  expect(errorDetail(new HistoryError(200, '{"o:errorCode":"FND-1","title":"nope"}', "FND-1"))).toEqual({
    message: 'Fusion error FND-1: history HTTP 200: {"o:errorCode":"FND-1","title":"nope"}',
    status: 200,
  });
  expect(errorDetail(new AttachmentError("link", 200, undefined, "FND-2"))).toEqual({
    message: "Fusion error FND-2: attachment link HTTP 200",
    status: 200,
  });
  const ep = new EndpointError("http", "BOSS", "/api/boss/x", "Fusion error FND-3: BOSS GET /api/boss/x (HTTP 200)", 200, {}, "OK", "FND-3");
  expect(errorDetail(ep)).toEqual({ message: "Fusion error FND-3: BOSS GET /api/boss/x (HTTP 200)", status: 200 });
});

test("plain_http_errors_keep_their_messages", () => {
  expect(errorDetail(new HistoryError(500, "boom"))).toEqual({ message: "history HTTP 500: boom", status: 500 });
  expect(errorDetail(new AttachmentError("upload", 500))).toEqual({ message: "attachment upload HTTP 500", status: 500 });
});

test("no_http_answer_has_no_status", () => {
  const net = new EndpointError("network", "FUAI", "/api/fusion-ai/x", "FUAI POST /api/fusion-ai/x: Failed to fetch");
  expect(errorDetail(net)).toEqual({ message: "FUAI POST /api/fusion-ai/x: Failed to fetch" });
  expect(statusOf(new EndpointError("refused", "BOSS", "/x", "refused"))).toBeUndefined();
  expect(errorDetail(new Error("x"))).toEqual({ message: "x" });
});

test("only_a_401_is_relogin", () => {
  expect(isRelogin(new HistoryError(401, "denied"))).toBe(true);
  expect(isRelogin(new AttachmentError("upload", 401))).toBe(true);
  expect(isRelogin(new EndpointError("http", "FUAI", "/api/fusion-ai/x", "m", 401))).toBe(true);
  expect(isRelogin(new HistoryError(403, "no"))).toBe(false);
  expect(isRelogin(new EndpointError("network", "FUAI", "/api/fusion-ai/x", "m"))).toBe(false);
});

test("history_failure_text", () => {
  expect(historyFailureText(new HistoryError(500, '{"detail":"boom"}'))).toBe("boom");
  expect(historyFailureText(new HistoryError(200, '{"o:errorCode":"FND-1","title":"nope"}', "FND-1"))).toBe("Fusion error FND-1: nope");
  expect(historyFailureText(new HistoryError(500))).toBe("");
  expect(historyFailureText(new Error("x"))).toBe("");
});

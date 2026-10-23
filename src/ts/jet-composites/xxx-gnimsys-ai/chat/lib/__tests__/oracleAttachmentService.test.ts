import { OracleAttachmentService, AttachmentError } from "../files/OracleAttachmentService";
import type { EndpointFetch } from "../endpoints/EndpointFetch";
import { fakeEndpoints, vb } from "./helpers.endpoints";

const HCM = "/hcmRestApi/resources/11.13.18.05";
const limits = { maxFiles: 5, maxSizeMB: 50, accept: [".pdf", ".txt", "image/*"] };
const svc = (endpoints: EndpointFetch) => new OracleAttachmentService({ endpoints, workflowCode: "WF_1", personId: "300", hcmRestBase: HCM, limits, now: () => 1234 });
const mk = (name: string, type = "", size = 10): File => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

test("validate_rejects_sixth_file_oversize_and_bad_type", () => {
  const { endpoints } = fakeEndpoints([]);
  const huge = mk("huge.pdf", "application/pdf", 51 * 1024 * 1024);
  const exe = mk("x.exe", "application/x-msdownload");
  const png = mk("pic.PNG", "image/png");
  const files = [mk("a.pdf"), mk("B.TXT"), huge, exe, png, mk("c.pdf"), mk("d.pdf"), mk("sixth.pdf")];
  const r = svc(endpoints).validate(files, 0);
  expect(r.ok.map((f) => f.name)).toEqual(["a.pdf", "B.TXT", "pic.PNG", "c.pdf", "d.pdf"]);
  expect(r.rejected.map((x) => [x.file.name, x.reason])).toEqual([["huge.pdf", "size"], ["x.exe", "type"], ["sixth.pdf", "count"]]);
  const r2 = svc(endpoints).validate([mk("a.pdf"), mk("b.pdf")], 4);
  expect(r2.ok.map((f) => f.name)).toEqual(["a.pdf"]);
  expect(r2.rejected.map((x) => [x.file.name, x.reason])).toEqual([["b.pdf", "count"]]);
});

test("validate_accepts_pdf_with_dotless_accept_list", () => {
  const { endpoints } = fakeEndpoints([]);
  const s = new OracleAttachmentService({ endpoints, workflowCode: "WF_1", personId: "300", hcmRestBase: HCM, limits: { maxFiles: 5, maxSizeMB: 50, accept: ["pdf"] } });
  const r = s.validate([mk("a.pdf")], 0);
  expect(r.ok.map((f) => f.name)).toEqual(["a.pdf"]);
  expect(r.rejected).toEqual([]);
});

test("ensureConversation_posts_once_per_id", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({}, 201), vb({}, 201)]);
  const s = svc(endpoints);
  await s.ensureConversation("c1");
  await s.ensureConversation("c1");
  expect(calls).toHaveLength(1);
  expect(calls[0].target).toBe("FA");
  expect(calls[0].url).toBe(`${HCM}/hcmAiStudioConversations`);
  expect(calls[0].method).toBe("POST");
  expect(new Headers(calls[0].headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(calls[0].body as string)).toEqual({ ConversationId: "c1", PersonId: "300", ObjectCode: "WF_1", ObjectType: "AGENT_TEAM" });
  await s.ensureConversation("c2");
  expect(calls).toHaveLength(2);
});

test("ensureConversation_parallel_calls_post_once", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({}, 201)]);
  const s = svc(endpoints);
  await Promise.all([s.ensureConversation("c1"), s.ensureConversation("c1")]);
  expect(calls).toHaveLength(1);
});

test("ensureConversation_failure_throws_AttachmentError", async () => {
  const { endpoints } = fakeEndpoints([vb("nope", 403)]);
  const e = await svc(endpoints).ensureConversation("c1").catch((x) => x);
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.body]).toEqual(["conversation", 403, "nope"]);
});

test("upload_calls_tracker_then_multipart_with_tracker_and_user", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ trackers: [{ trackerId: "trk-1" }], username: "bob" }), vb({}, 200)]);
  const file = mk("doc.pdf", "application/pdf", 77);
  const r = await svc(endpoints).upload(file);
  expect(r).toEqual({ trackerId: "trk-1", fileName: "doc.pdf", size: 77, mimeType: "application/pdf" });
  expect(calls[0].target).toBe("FA");
  expect(calls[0].url).toBe("/fscmRestApi/applcoreApi/v1/attachDocTracker/");
  expect(calls[0].method).toBe("POST");
  expect(new Headers(calls[0].headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(calls[0].body as string)).toEqual([{ clientfileid: 1234, filename: "doc.pdf", mimetype: "application/pdf", size: 77 }]);
  expect(calls[1].target).toBe("FA");
  expect(calls[1].url).toBe("/fscmRestApi/applcoreApi/v1/attachUpload");
  expect(calls[1].method).toBe("POST");
  const fd = calls[1].body as FormData;
  expect(fd).toBeInstanceOf(FormData);
  expect(fd.get("tracker")).toBe("trk-1");
  expect(fd.get("user")).toBe("bob");
  expect(fd.get("filename")).toBe("doc.pdf");
  expect(fd.get("size")).toBe("77");
  expect(fd.get("mimetype")).toBe("application/pdf");
  expect(fd.get("file")).toBeInstanceOf(File);
  expect(new Headers(calls[1].headers).get("Content-Type")).toBeNull();
});

test("upload_tracker_without_ids_names_the_step", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ trackers: [] }), vb("<html>login</html>")]);
  const e = await svc(endpoints).upload(mk("a.pdf")).catch((x) => x);
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.body]).toEqual(["tracker", 200, "trackerId/username missing"]);
  const t = await svc(endpoints).upload(mk("a.pdf")).catch((x) => x);
  expect([t.step, t.status, t.body]).toEqual(["tracker", 200, "trackerId/username missing"]);
  expect(calls).toHaveLength(2); // no upload after a failed tracker
});

test("upload_empty_type_uses_octet_stream_and_failure_names_step", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ trackers: [{ trackerId: "t" }], username: "u" }), vb("bad", 500)]);
  const e = await svc(endpoints).upload(mk("a.txt", "")).catch((x) => x);
  expect(JSON.parse(calls[0].body as string)[0].mimetype).toBe("application/octet-stream");
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.body]).toEqual(["upload", 500, "bad"]);
});

test("link_sends_adf_batch_create_parts", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({})]);
  await svc(endpoints).link("c1", [
    { trackerId: "t1", fileName: "a.pdf", size: 1, mimeType: "application/pdf" },
    { trackerId: "t2", fileName: "b.txt", size: 2, mimeType: "text/plain" },
  ]);
  expect(calls[0].target).toBe("FA");
  expect(calls[0].url).toBe(`${HCM}/`);
  expect(calls[0].method).toBe("POST");
  expect(new Headers(calls[0].headers).get("Content-Type")).toBe("application/vnd.oracle.adf.batch+json");
  const mkPart = (n: number, t: string, f: string) => ({
    id: `attachment_${n}`, operation: "create", path: "/hcmAiStudioConversations/c1/child/Attachments",
    payload: { AsyncTrackerId: t, CategoryName: null, ContentRepositoryFileShared: "false", DatatypeCode: "FILE", FileName: f, Title: f, UploadedFileName: f },
  });
  expect(JSON.parse(calls[0].body as string)).toEqual({ parts: [mkPart(1, "t1", "a.pdf"), mkPart(2, "t2", "b.txt")] });
});

test("oerrorcode_on_200_is_a_prefixed_AttachmentError", async () => {
  const { endpoints, calls } = fakeEndpoints([vb({ "o:errorCode": "FND-2", detail: "no tracker" }, 200)]);
  const e = await svc(endpoints).upload(mk("a.pdf")).catch((x) => x);
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.fusionErrorCode]).toEqual(["tracker", 200, "FND-2"]);
  expect(e.message).toBe('Fusion error FND-2: attachment tracker HTTP 200: {"o:errorCode":"FND-2","detail":"no tracker"}');
  expect(calls).toHaveLength(1); // nothing uploaded after the failed tracker
});

test("link_failure_names_step", async () => {
  const { endpoints } = fakeEndpoints([vb({ detail: "bad batch" }, 400)]);
  const e = await svc(endpoints).link("c1", [{ trackerId: "t1", fileName: "a.pdf", size: 1, mimeType: "application/pdf" }]).catch((x) => x);
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.body]).toEqual(["link", 400, '{"detail":"bad batch"}']);
});

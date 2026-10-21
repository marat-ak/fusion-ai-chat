import { OracleAttachmentService, AttachmentError } from "../files/OracleAttachmentService";
import type { Audience, AuthFetch } from "../auth/AuthFetch";
import { fakeResponse } from "./helpers.auth";

const O = "https://pod.example.com";
const HCM = "/hcmRestApi/resources/11.13.18.05";
type Call = { audience: Audience; url: string; init: RequestInit };

function fake(responses: Response[]): { auth: AuthFetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  return { calls, auth: { fetch: async (audience, url, init) => { calls.push({ audience, url, init: init as RequestInit }); return queue.shift() as Response; } } };
}
const limits = { maxFiles: 5, maxSizeMB: 50, accept: [".pdf", ".txt", "image/*"] };
const svc = (auth: AuthFetch) => new OracleAttachmentService({ auth, workflowCode: "WF_1", personId: "300", hcmRestBase: HCM, limits, origin: O, now: () => 1234 });
const mk = (name: string, type = "", size = 10): File => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

test("validate_rejects_sixth_file_oversize_and_bad_type", () => {
  const { auth } = fake([]);
  const huge = mk("huge.pdf", "application/pdf", 51 * 1024 * 1024);
  const exe = mk("x.exe", "application/x-msdownload");
  const png = mk("pic.PNG", "image/png");
  const files = [mk("a.pdf"), mk("B.TXT"), huge, exe, png, mk("c.pdf"), mk("d.pdf"), mk("sixth.pdf")];
  const r = svc(auth).validate(files, 0);
  expect(r.ok.map((f) => f.name)).toEqual(["a.pdf", "B.TXT", "pic.PNG", "c.pdf", "d.pdf"]);
  expect(r.rejected.map((x) => [x.file.name, x.reason])).toEqual([["huge.pdf", "size"], ["x.exe", "type"], ["sixth.pdf", "count"]]);
  const r2 = svc(auth).validate([mk("a.pdf"), mk("b.pdf")], 4);
  expect(r2.ok.map((f) => f.name)).toEqual(["a.pdf"]);
  expect(r2.rejected.map((x) => [x.file.name, x.reason])).toEqual([["b.pdf", "count"]]);
});

test("ensureConversation_posts_once_per_id", async () => {
  const { auth, calls } = fake([fakeResponse("{}", { status: 201 }), fakeResponse("{}", { status: 201 })]);
  const s = svc(auth);
  await s.ensureConversation("c1");
  await s.ensureConversation("c1");
  expect(calls).toHaveLength(1);
  expect(calls[0].audience).toBe("rest");
  expect(calls[0].url).toBe(`${O}${HCM}/hcmAiStudioConversations`);
  expect(calls[0].init.method).toBe("POST");
  expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ ConversationId: "c1", PersonId: "300", ObjectCode: "WF_1", ObjectType: "AGENT_TEAM" });
  await s.ensureConversation("c2");
  expect(calls).toHaveLength(2);
});

test("ensureConversation_failure_throws_AttachmentError", async () => {
  const { auth } = fake([fakeResponse("nope", { status: 403 })]);
  const e = await svc(auth).ensureConversation("c1").catch((x) => x);
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status, e.body]).toEqual(["conversation", 403, "nope"]);
});

test("upload_calls_tracker_then_multipart_with_tracker_and_user", async () => {
  const { auth, calls } = fake([fakeResponse(JSON.stringify({ trackers: [{ trackerId: "trk-1" }], username: "bob" })), fakeResponse("{}", { status: 200 })]);
  const file = mk("doc.pdf", "application/pdf", 77);
  const r = await svc(auth).upload(file);
  expect(r).toEqual({ trackerId: "trk-1", fileName: "doc.pdf", size: 77, mimeType: "application/pdf" });
  expect(calls[0].audience).toBe("rest");
  expect(calls[0].url).toBe(`${O}/fscmRestApi/applcoreApi/v1/attachDocTracker/`);
  expect(calls[0].init.method).toBe("POST");
  expect(JSON.parse(calls[0].init.body as string)).toEqual([{ clientfileid: 1234, filename: "doc.pdf", mimetype: "application/pdf", size: 77 }]);
  expect(calls[1].url).toBe(`${O}/fscmRestApi/applcoreApi/v1/attachUpload`);
  expect(calls[1].init.method).toBe("POST");
  const fd = calls[1].init.body as FormData;
  expect(fd).toBeInstanceOf(FormData);
  expect(fd.get("tracker")).toBe("trk-1");
  expect(fd.get("user")).toBe("bob");
  expect(fd.get("filename")).toBe("doc.pdf");
  expect(fd.get("size")).toBe("77");
  expect(fd.get("mimetype")).toBe("application/pdf");
  expect(fd.get("file")).toBeInstanceOf(File);
  expect(new Headers(calls[1].init.headers).get("Content-Type")).toBeNull();
});

test("upload_empty_type_uses_octet_stream_and_failure_names_step", async () => {
  const { auth, calls } = fake([fakeResponse(JSON.stringify({ trackers: [{ trackerId: "t" }], username: "u" })), fakeResponse("bad", { status: 500 })]);
  const e = await svc(auth).upload(mk("a.txt", "")).catch((x) => x);
  expect(JSON.parse(calls[0].init.body as string)[0].mimetype).toBe("application/octet-stream");
  expect(e).toBeInstanceOf(AttachmentError);
  expect([e.step, e.status]).toEqual(["upload", 500]);
});

test("link_sends_adf_batch_create_parts", async () => {
  const { auth, calls } = fake([fakeResponse("{}")]);
  await svc(auth).link("c1", [
    { trackerId: "t1", fileName: "a.pdf", size: 1, mimeType: "application/pdf" },
    { trackerId: "t2", fileName: "b.txt", size: 2, mimeType: "text/plain" },
  ]);
  expect(calls[0].audience).toBe("rest");
  expect(calls[0].url).toBe(`${O}${HCM}/`);
  expect(calls[0].init.method).toBe("POST");
  expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/vnd.oracle.adf.batch+json");
  const mkPart = (n: number, t: string, f: string) => ({
    id: `attachment_${n}`, operation: "create", path: "/hcmAiStudioConversations/c1/child/Attachments",
    payload: { AsyncTrackerId: t, CategoryName: null, ContentRepositoryFileShared: "false", DatatypeCode: "FILE", FileName: f, Title: f, UploadedFileName: f },
  });
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ parts: [mkPart(1, "t1", "a.pdf"), mkPart(2, "t2", "b.txt")] });
});

import { filesAloneSendable } from "../files/AttachmentService";

// Files may go without a text (Oracle's chat client sends `message: ""` once every attachment is ready); here files upload
// when the message is sent, so "ready" = picked and waiting to go.
test("files_alone_are_sendable_when_every_picked_file_waits_to_go", () => {
  expect(filesAloneSendable([])).toBe(false);
  expect(filesAloneSendable([{ state: "pending" }])).toBe(true);
  expect(filesAloneSendable([{ state: "pending" }, { state: "pending" }])).toBe(true);
  // An upload in progress or a failed one blocks a file-only send (a message with text keeps its own rule).
  expect(filesAloneSendable([{ state: "pending" }, { state: "uploading" }])).toBe(false);
  expect(filesAloneSendable([{ state: "failed" }])).toBe(false);
  expect(filesAloneSendable([{ state: "pending" }, { state: "failed" }])).toBe(false);
  expect(filesAloneSendable([{ state: "uploaded" }])).toBe(false);
});

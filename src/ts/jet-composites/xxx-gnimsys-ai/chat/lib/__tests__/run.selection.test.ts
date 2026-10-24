// Design §5.1: restored choices, what is stored, run changes. The page-level effects (the chat remounting in a new
// conversation, the host event) are in the e2e (tests/e2e/run.spec.ts).
import { HistoryError } from "../history/HistoryStore";
import { resolvePlan } from "../run/plan";
import { RunSelection } from "../run/selection";
import { runStorageKey, sessionRunStorage } from "../run/storage";
import { BOTH, SETTINGS, fakeAgents, selection } from "./helpers.run";

const stored = (choice: object) => ({ kind: "choice" as const, choice });

describe("restored_choice_revalidated", () => {
  test("kept_when_the_role_is_held_and_the_agent_still_listed_for_that_version", async () => {
    const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A", version: "DRAFT" }), versions: { WF_A: ["PUBLISHED", "DRAFT"] } });
    // Checked before anything runs: no picker flash, no chat yet.
    expect(s.ctl.get().phase).toBe("checking");
    await s.ctl.start();
    expect(s.dir.calls).toEqual(["WF_A"]);
    expect(s.ctl.get()).toEqual({ phase: "running", run: { workflowCode: "WF_A", version: "DRAFT" }, generation: 1, note: null });
    expect(s.store.removes()).toBe(0);
  });

  test("dropped_when_the_draft_role_is_no_longer_held", async () => {
    // Stored under "nothing bound" with both roles; the user now holds the all-agents role only (row: Published list).
    const s = selection({ bound: {}, settings: SETTINGS, roles: ["PICK_AGENTS"], stored: stored({ workflowCode: "WF_A", version: "DRAFT" }), versions: { WF_A: ["DRAFT"] } });
    expect(s.ctl.get()).toMatchObject({ phase: "choosing", run: null });
    expect(s.ctl.get().note).toBe("Your earlier choice (WF_A · Draft) is no longer available: running drafts needs a role you no longer hold. Choose again.");
    await s.ctl.start();
    // Refused before any pod call, and dropped from storage: never a silent substitute.
    expect([s.dir.calls, s.store.removes(), s.changes]).toEqual([[], 1, []]);
  });

  test("dropped_when_the_agent_is_no_longer_listed_for_that_version", async () => {
    const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A", version: "DRAFT" }), versions: { WF_A: ["PUBLISHED"] } });
    await s.ctl.start();
    expect(s.ctl.get()).toMatchObject({ phase: "choosing", run: null });
    expect(s.ctl.get().note).toBe("Your earlier choice (WF_A · Draft) is no longer available: WF_A has no draft version you can run now. Choose again.");
    expect([s.store.removes(), s.changes]).toEqual([1, []]);
  });

  test("bound_agent_version_choice_checked_against_its_versions", async () => {
    const ok = selection({ bound: { workflowCode: "WF_A" }, settings: SETTINGS, roles: ["RUN_DRAFTS"], stored: stored({ version: "DRAFT" }), versions: { WF_A: ["PUBLISHED", "DRAFT"] } });
    await ok.ctl.start();
    expect(ok.ctl.get().run).toEqual({ workflowCode: "WF_A", version: "DRAFT" });
    const gone = selection({ bound: { workflowCode: "WF_A" }, settings: SETTINGS, roles: ["RUN_DRAFTS"], stored: stored({ version: "DRAFT" }), versions: { WF_A: ["PUBLISHED"] } });
    await gone.ctl.start();
    expect(gone.ctl.get()).toMatchObject({ phase: "choosing", run: null });
  });

  test("incomplete_or_unreadable_is_dropped_with_a_note", async () => {
    // Stored without a version (the user had no draft role then); now the version is theirs to choose.
    const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A" }) });
    expect(s.ctl.get().note).toBe("Your earlier choice (WF_A) is no longer available: it is incomplete. Choose again.");
    await s.ctl.start();
    expect(s.store.removes()).toBe(1);
    const u = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: { kind: "unreadable" } });
    expect(u.ctl.get()).toMatchObject({ phase: "choosing", note: "Your earlier choice could not be read. Choose again." });
    await u.ctl.start();
    expect(u.store.removes()).toBe(1);
  });

  test("a_failed_check_shows_the_picker_with_a_note_and_keeps_the_choice", async () => {
    const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A", version: "PUBLISHED" }), versions: { WF_A: new HistoryError(503, "down") } });
    await s.ctl.start();
    expect(s.ctl.get()).toMatchObject({ phase: "choosing", run: null, note: "Your earlier choice (WF_A · Published) could not be checked (HTTP 503). Choose again." });
    expect([s.errors.length, s.store.removes(), s.changes]).toEqual([1, 0, []]);
  });
});

test("storage_throwing_shows_picker", async () => {
  const throwing = (): Storage => { throw new DOMException("denied", "SecurityError"); };
  const broken = {
    getItem: () => { throw new DOMException("denied", "SecurityError"); },
    setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
    removeItem: () => { throw new DOMException("denied", "SecurityError"); },
  } as unknown as Storage;
  for (const access of [throwing, () => broken]) {
    const changes: unknown[] = [];
    const dir = fakeAgents({ WF_A: ["PUBLISHED"] });
    const ctl = new RunSelection({
      plan: resolvePlan({}, SETTINGS, ["PICK_AGENTS"]),
      storage: sessionRunStorage(runStorageKey("/page", {}), access),
      agents: dir.agents, onRunChanged: (r) => changes.push(r), onError: () => undefined,
    });
    // Nothing readable: the picker, without a note.
    expect(ctl.get()).toEqual({ phase: "choosing", run: null, generation: 0, note: null });
    await ctl.start();
    // Choosing still runs the agent; only keeping it across a refresh is lost.
    ctl.choose({ workflowCode: "WF_A" });
    expect(ctl.get()).toMatchObject({ phase: "running", run: { workflowCode: "WF_A", version: "PUBLISHED" } });
    expect(changes).toEqual([{ workflowCode: "WF_A", version: "PUBLISHED" }]);
  }
});

test("bound_parts_never_stored", () => {
  // Agent bound (draft role): only the chosen version is stored, never the bound agent, whatever the choice says.
  const a = selection({ bound: { workflowCode: "WF_A" }, settings: SETTINGS, roles: ["RUN_DRAFTS"] });
  a.ctl.choose({ workflowCode: "OTHER", version: "DRAFT" });
  expect(a.store.writes).toEqual([{ version: "DRAFT" }]);
  expect(a.ctl.get().run).toEqual({ workflowCode: "WF_A", version: "DRAFT" });
  // Version bound: only the chosen agent.
  const v = selection({ bound: { version: "DRAFT" }, settings: SETTINGS, roles: ["PICK_AGENTS"] });
  v.ctl.choose({ workflowCode: "WF_B", version: "PUBLISHED" });
  expect(v.store.writes).toEqual([{ workflowCode: "WF_B" }]);
  expect(v.ctl.get().run).toEqual({ workflowCode: "WF_B", version: "DRAFT" });
  // Nothing bound, Published by role: the version was not chosen, so it is not stored either.
  const p = selection({ bound: {}, settings: SETTINGS, roles: ["PICK_AGENTS"] });
  p.ctl.choose({ workflowCode: "WF_C" });
  expect(p.store.writes).toEqual([{ workflowCode: "WF_C" }]);
  // Both bound: nothing to choose, nothing stored.
  const b = selection({ bound: { workflowCode: "WF_A", version: "PUBLISHED" }, settings: SETTINGS, roles: BOTH });
  b.ctl.choose({ workflowCode: "WF_X", version: "DRAFT" });
  expect([b.store.writes, b.ctl.get().run]).toEqual([[], { workflowCode: "WF_A", version: "PUBLISHED" }]);
});

test("change_starts_new_conversation", () => {
  const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH });
  s.ctl.choose({ workflowCode: "WF_A", version: "PUBLISHED" });
  expect(s.ctl.get()).toMatchObject({ phase: "running", generation: 1 });
  // "Change" reopens the panel with the chat kept behind it; Cancel returns to it unchanged.
  s.ctl.openChooser();
  expect(s.ctl.get()).toMatchObject({ phase: "choosing", run: { workflowCode: "WF_A", version: "PUBLISHED" }, generation: 1 });
  s.ctl.cancel();
  expect(s.ctl.get()).toMatchObject({ phase: "running", generation: 1 });
  // The same run again is no change: the chat (keyed on the generation) stays in its conversation.
  s.ctl.openChooser();
  s.ctl.choose({ workflowCode: "WF_A", version: "PUBLISHED" });
  expect(s.ctl.get()).toMatchObject({ phase: "running", generation: 1 });
  // Another version or agent is a new generation: the chat remounts in a new conversation.
  s.ctl.openChooser();
  s.ctl.choose({ workflowCode: "WF_A", version: "DRAFT" });
  expect(s.ctl.get()).toMatchObject({ phase: "running", run: { workflowCode: "WF_A", version: "DRAFT" }, generation: 2 });
  s.ctl.openChooser();
  s.ctl.choose({ workflowCode: "WF_B", version: "DRAFT" });
  expect(s.ctl.get().generation).toBe(3);
  // A fixed plan has no "Change".
  const fixed = selection({ bound: { workflowCode: "WF_A", version: "DRAFT" } });
  fixed.ctl.openChooser();
  expect(fixed.ctl.get().phase).toBe("running");
});

test("run_changed_event_fires", async () => {
  // A bound run: once, when the selection starts.
  const b = selection({ bound: { workflowCode: "WF_A", version: "DRAFT" } });
  expect(b.changes).toEqual([]);
  await b.ctl.start();
  await b.ctl.start();
  expect(b.changes).toEqual([{ workflowCode: "WF_A", version: "DRAFT" }]);
  // Chosen runs: each change, never a re-pick of the same run.
  const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH });
  await s.ctl.start();
  expect(s.changes).toEqual([]);
  s.ctl.choose({ workflowCode: "WF_A", version: "PUBLISHED" });
  s.ctl.openChooser();
  s.ctl.choose({ workflowCode: "WF_A", version: "PUBLISHED" });
  s.ctl.openChooser();
  s.ctl.choose({ workflowCode: "WF_B", version: "DRAFT" });
  expect(s.changes).toEqual([{ workflowCode: "WF_A", version: "PUBLISHED" }, { workflowCode: "WF_B", version: "DRAFT" }]);
  // A restored run: once it has passed its check.
  const r = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A", version: "DRAFT" }), versions: { WF_A: ["DRAFT"] } });
  await r.ctl.start();
  expect(r.changes).toEqual([{ workflowCode: "WF_A", version: "DRAFT" }]);
  // Nothing after dispose (the component unmounted or rebuilt its selection).
  const d = selection({ bound: {}, settings: SETTINGS, roles: BOTH, stored: stored({ workflowCode: "WF_A", version: "DRAFT" }), versions: { WF_A: ["DRAFT"] } });
  const started = d.ctl.start();
  d.ctl.dispose();
  await started;
  expect(d.changes).toEqual([]);
});

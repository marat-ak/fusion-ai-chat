// Design §5.1, one test per row of the behaviour table: the plan (what the user may choose, what is fixed) and what the
// page shows first (RunSelection's first state; `running` = the chat, `choosing` = the run panel).
import { choosesAgent, choosesVersion, resolvePlan } from "../run/plan";
import type { ChoosePlan } from "../run/plan";
import { BOTH, SETTINGS, selection } from "./helpers.run";

const choose = (p: ReturnType<typeof resolvePlan>): ChoosePlan => {
  if (p.kind !== "choose") throw new Error("expected a choose plan, got " + p.kind);
  return p;
};

// | agent + version | — | no choice; runs it (no role check) |
test("bound_both_no_choice", async () => {
  for (const roles of [[], BOTH]) {
    for (const settings of [undefined, SETTINGS]) {
      const s = selection({ bound: { workflowCode: "WF_A", version: "DRAFT" }, ...(settings && { settings }), roles });
      expect(s.plan).toEqual({ kind: "run", run: { workflowCode: "WF_A", version: "DRAFT" } });
      expect(s.ctl.get()).toEqual({ phase: "running", run: { workflowCode: "WF_A", version: "DRAFT" }, generation: 1, note: null });
      await s.ctl.start();
      // No role check and no pod call: the bound run runs as is.
      expect(s.dir.calls).toEqual([]);
    }
  }
});

// | agent only | draft role | version choice limited to the versions that agent has |
test("agent_only_draft_role_chooses_version", () => {
  const s = selection({ bound: { workflowCode: "WF_A" }, settings: SETTINGS, roles: ["RUN_DRAFTS"] });
  const plan = choose(s.plan);
  expect(plan).toEqual({ kind: "choose", workflowCode: "WF_A" });
  expect([choosesAgent(plan), choosesVersion(plan)]).toEqual([false, true]);
  // The panel offers the agent's own versions (RunPanel reads them with versionsOf(plan.workflowCode)).
  expect(s.ctl.get().phase).toBe("choosing");
});

// | agent only | no draft role | runs Published |
test("agent_only_no_draft_role_runs_published", () => {
  for (const [settings, roles] of [[undefined, BOTH], [SETTINGS, ["PICK_AGENTS"]], [SETTINGS, []]] as const) {
    const s = selection({ bound: { workflowCode: "WF_A" }, ...(settings && { settings }), roles: [...roles] });
    expect(s.plan).toEqual({ kind: "run", run: { workflowCode: "WF_A", version: "PUBLISHED" } });
    expect(s.ctl.get().phase).toBe("running");
  }
});

// | version only | all-agents role | agent list for that version |
test("version_only_all_agents_role_lists", () => {
  for (const version of ["DRAFT", "PUBLISHED"] as const) {
    // The bound version needs no draft role: roles only gate choosing.
    const s = selection({ bound: { version }, settings: SETTINGS, roles: ["PICK_AGENTS"] });
    const plan = choose(s.plan);
    expect(plan).toEqual({ kind: "choose", version });
    expect([choosesAgent(plan), choosesVersion(plan)]).toEqual([true, false]);
    expect(s.ctl.get().phase).toBe("choosing");
  }
});

// | nothing | all-agents + draft | version -> refreshed agent list -> agent |
test("nothing_both_roles_version_then_agent", () => {
  const s = selection({ bound: {}, settings: SETTINGS, roles: BOTH });
  const plan = choose(s.plan);
  expect(plan).toEqual({ kind: "choose" });
  expect([choosesAgent(plan), choosesVersion(plan)]).toEqual([true, true]);
  expect(s.ctl.get().phase).toBe("choosing");
});

// | nothing | all-agents only | Published agent list -> agent |
test("nothing_all_agents_only_published_list", () => {
  const s = selection({ bound: {}, settings: SETTINGS, roles: ["PICK_AGENTS"] });
  const plan = choose(s.plan);
  expect(plan).toEqual({ kind: "choose", version: "PUBLISHED" });
  expect([choosesAgent(plan), choosesVersion(plan)]).toEqual([true, false]);
});

// | nothing / version only | no all-agents role | explicit panel "No agent in this link" |
test("no_all_agents_role_no_agent_panel", async () => {
  const cases = [
    { bound: {}, roles: ["RUN_DRAFTS"] },
    { bound: {}, roles: [] },
    { bound: { version: "DRAFT" as const }, roles: ["RUN_DRAFTS"] },
    { bound: { version: "PUBLISHED" as const }, roles: [] },
  ];
  for (const c of cases) {
    for (const settings of [undefined, SETTINGS]) {
      const s = selection({ ...c, ...(settings && { settings }) });
      expect(s.plan).toEqual({ kind: "no-agent" });
      expect(s.ctl.get()).toEqual({ phase: "no-agent", run: null, generation: 0, note: null });
      await s.ctl.start();
      // Explicit: no default agent, no pod call, nothing stored.
      expect([s.dir.calls, s.store.writes, s.changes]).toEqual([[], [], []]);
    }
  }
  // An empty role list = nobody.
  expect(resolvePlan({}, { allAgentsRoles: [], draftRoles: [] }, BOTH)).toEqual({ kind: "no-agent" });
});

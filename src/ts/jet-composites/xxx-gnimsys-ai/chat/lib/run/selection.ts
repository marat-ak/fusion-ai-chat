// The run selection of one mounted chat (design §5.1): what the page shows (the explicit "No agent in this link" panel,
// the check of a restored choice, the run panel, or the chat) and which run the chat runs. The plan (plan.ts) says what
// the user may choose; this keeps the choice in the tab's storage (storage.ts) for the unbound parts only, re-checks a
// restored choice before running it, and reports every run change (the host's `aiChatRunChanged`; the chat remounts in a
// new conversation).
import type { ArtifactVersion, Run } from "../config/types";
import { errorDetail } from "../errors";
import { VERSION_LABELS } from "./plan";
import type { ChoosePlan, RunPlan } from "./plan";
import type { RunStorage, StoredChoice } from "./storage";
import type { AgentDirectory } from "./OracleAgentDirectory";

export type RunPhase = "no-agent" | "checking" | "choosing" | "running";

export interface RunState {
  phase: RunPhase;
  /** The run the chat runs; while choosing after "Change", the one behind the panel (Cancel returns to it). */
  run: Run | null;
  /** Bumped by every run change: the chat is keyed on it, so another run starts in a new conversation. */
  generation: number;
  /**
   * Why a restored choice was dropped, or could not be checked: shown on the run panel, or above the run when the page
   * leaves the user nothing to choose any more (e.g. a stored draft after the draft role was lost).
   */
  note: string | null;
}

export interface RunSelectionDeps {
  plan: RunPlan;
  storage: RunStorage;
  agents: Pick<AgentDirectory, "versionsOf">;
  /** Every run change, the first one included (bound runs: when start() runs). */
  onRunChanged: (run: Run) => void;
  /** A failed check of a restored choice (also shown as the panel's note). */
  onError: (e: unknown) => void;
}

const runText = (run: { workflowCode?: string; version?: ArtifactVersion }): string =>
  [run.workflowCode, run.version !== undefined ? VERSION_LABELS[run.version] : undefined].filter((s) => s !== undefined).join(" · ");

/** The run a stored choice completes under a choose plan, or why it does not fit (before any pod call). */
export function restoredRun(plan: ChoosePlan, choice: StoredChoice): { ok: true; run: Run } | { ok: false; reason: string } {
  if (plan.workflowCode !== undefined && choice.workflowCode !== undefined && choice.workflowCode !== plan.workflowCode) {
    return { ok: false, reason: "it was made for another agent" };
  }
  if (plan.version !== undefined && choice.version !== undefined && choice.version !== plan.version) {
    return { ok: false, reason: choice.version === "DRAFT" ? "running drafts needs a role you no longer hold" : "this page no longer offers that version" };
  }
  const workflowCode = plan.workflowCode ?? choice.workflowCode;
  const version = plan.version ?? choice.version;
  if (workflowCode === undefined || version === undefined) return { ok: false, reason: "it is incomplete" };
  return { ok: true, run: { workflowCode, version } };
}

/** The note of a dropped stored choice, naming it with the page's fixed parts (e.g. "WF_A · Draft"). */
function droppedNote(plan: ChoosePlan, choice: StoredChoice, reason: string, chooseAgain: boolean): string {
  const shown = runText({
    ...((choice.workflowCode ?? plan.workflowCode) !== undefined && { workflowCode: choice.workflowCode ?? plan.workflowCode }),
    ...((choice.version ?? plan.version) !== undefined && { version: choice.version ?? plan.version }),
  });
  return `Your earlier choice (${shown}) is no longer available: ${reason}.${chooseAgain ? " Choose again." : ""}`;
}

const errorText = (e: unknown): string => {
  const d = errorDetail(e);
  return d.status ? `HTTP ${d.status}` : d.message;
};

export class RunSelection {
  readonly plan: RunPlan;
  private readonly deps: RunSelectionDeps;
  private state: RunState;
  private readonly listeners = new Set<(s: RunState) => void>();
  private disposed = false;
  private started = false;
  /** Set by the constructor: the stored value to drop, the restored run to check. */
  private dropStored = false;
  private pending: Run | null = null;

  /** The first state is decided synchronously (the page shows it at once); start() does the rest. */
  constructor(deps: RunSelectionDeps) {
    this.deps = deps;
    this.plan = deps.plan;
    const plan = deps.plan;
    const base = { run: null, generation: 0, note: null };
    if (plan.kind === "no-agent") {
      // Nothing is chosen here: a value stored under this page's key while the user could choose is dropped.
      if (this.deps.storage.read().kind !== "none") this.dropStored = true;
      this.state = { ...base, phase: "no-agent" };
    } else if (plan.kind === "run") {
      this.state = { ...base, phase: "running", run: plan.run, generation: 1, note: this.dropForFixedRun(plan.run) };
    } else {
      this.state = this.restore(plan);
    }
  }

  /**
   * A run plan chooses nothing: a value stored under this page's key while the user could choose (e.g. a draft, before the
   * draft role was lost) is dropped, and when it would have run something else the note says why (shown above the run).
   */
  private dropForFixedRun(run: Run): string | null {
    const stored = this.deps.storage.read();
    if (stored.kind === "none") return null;
    this.dropStored = true;
    if (stored.kind === "unreadable") return "Your earlier choice could not be read.";
    const fixed: ChoosePlan = { kind: "choose", workflowCode: run.workflowCode, version: run.version };
    const r = restoredRun(fixed, stored.choice);
    return r.ok ? null : droppedNote(fixed, stored.choice, r.reason, false);
  }

  private restore(plan: ChoosePlan): RunState {
    const choosing: RunState = { phase: "choosing", run: null, generation: 0, note: null };
    const stored = this.deps.storage.read();
    if (stored.kind === "none") return choosing;
    if (stored.kind === "unreadable") {
      this.dropStored = true;
      return { ...choosing, note: "Your earlier choice could not be read. Choose again." };
    }
    const r = restoredRun(plan, stored.choice);
    if (!r.ok) {
      this.dropStored = true;
      return { ...choosing, note: droppedNote(plan, stored.choice, r.reason, true) };
    }
    this.pending = r.run;
    return { ...choosing, phase: "checking" };
  }

  get(): RunState {
    return this.state;
  }

  subscribe(listener: (s: RunState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(next: RunState): void {
    this.state = next;
    for (const l of [...this.listeners]) l(next);
  }

  /** Once per mount: drops what the constructor refused, reports a bound run, checks a restored choice against the pod. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.dropStored) this.deps.storage.remove();
    if (this.state.phase === "running" && this.state.run !== null) this.deps.onRunChanged(this.state.run);
    const run = this.pending;
    if (run === null) return;
    this.pending = null;
    // A bound agent (its version restored) is never checked against the list; a picked one must still be listed.
    const listedOnly = this.plan.kind === "choose" && this.plan.workflowCode === undefined;
    let versions: ArtifactVersion[];
    try {
      versions = await this.deps.agents.versionsOf(run.workflowCode, { listedOnly });
    } catch (e) {
      if (this.disposed) return;
      this.deps.onError(e);
      // Not dropped: the check failed, not the choice.
      this.set({ ...this.state, phase: "choosing", note: `Your earlier choice (${runText(run)}) could not be checked (${errorText(e)}). Choose again.` });
      return;
    }
    if (this.disposed) return;
    if (versions.includes(run.version)) {
      this.apply(run);
      return;
    }
    this.deps.storage.remove();
    const why = `${run.workflowCode} has no ${VERSION_LABELS[run.version].toLowerCase()} version you can run now`;
    this.set({ ...this.state, phase: "choosing", note: `Your earlier choice (${runText(run)}) is no longer available: ${why}. Choose again.` });
  }

  /** The run starts (or stays, when it is the current one); only a different run counts as a change. */
  private apply(run: Run): void {
    const current = this.state.run;
    if (current !== null && current.workflowCode === run.workflowCode && current.version === run.version) {
      this.set({ ...this.state, phase: "running", note: null });
      return;
    }
    this.set({ phase: "running", run, generation: this.state.generation + 1, note: null });
    this.deps.onRunChanged(run);
  }

  /**
   * The user's choice from the run panel: the parts the plan leaves to the user (fixed parts come from the plan, whatever
   * the choice says). Only the chosen parts are stored.
   */
  choose(choice: StoredChoice): void {
    const plan = this.plan;
    if (this.disposed || plan.kind !== "choose" || this.state.phase !== "choosing") return;
    const workflowCode = plan.workflowCode ?? choice.workflowCode;
    const version = plan.version ?? choice.version;
    if (workflowCode === undefined || version === undefined) return;
    this.deps.storage.write({
      ...(plan.workflowCode === undefined && { workflowCode }),
      ...(plan.version === undefined && { version }),
    });
    this.apply({ workflowCode, version });
  }

  /** The header's "Change": the run panel again, the chat kept behind it. */
  openChooser(): void {
    if (this.disposed || this.plan.kind !== "choose" || this.state.phase !== "running") return;
    this.set({ ...this.state, phase: "choosing", note: null });
  }

  /** Back to the running chat, unchanged. */
  cancel(): void {
    if (this.disposed || this.state.phase !== "choosing" || this.state.run === null) return;
    this.set({ ...this.state, phase: "running" });
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

// Test helpers (not a test file): a RunSelection over an in-memory storage and a fake agent directory.
import type { ArtifactVersion, Run, RunSettings } from "../config/types";
import { resolvePlan } from "../run/plan";
import type { Bound } from "../run/plan";
import { RunSelection } from "../run/selection";
import type { RunStorage, StoredChoice, StoredRead } from "../run/storage";

export const SETTINGS: RunSettings = { allAgentsRoles: ["PICK_AGENTS"], draftRoles: ["RUN_DRAFTS"] };
export const BOTH = ["PICK_AGENTS", "RUN_DRAFTS"];

/** A storage holding one value (or throwing on every access); `writes` / `removes` record what the selection did. */
export function memoryStorage(initial: StoredRead = { kind: "none" }) {
  let current = initial;
  const writes: StoredChoice[] = [];
  let removes = 0;
  const storage: RunStorage = {
    read: () => current,
    write: (c) => { writes.push(c); current = { kind: "choice", choice: c }; },
    remove: () => { removes++; current = { kind: "none" }; },
  };
  return { storage, writes, removes: () => removes };
}

/** The versions each agent has; a code mapped to an Error makes versionsOf reject with it. */
export function fakeAgents(versions: Record<string, ArtifactVersion[] | Error>) {
  const calls: string[] = [];
  return {
    calls,
    agents: {
      versionsOf: (code: string): Promise<ArtifactVersion[]> => {
        calls.push(code);
        const v = versions[code];
        return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? []);
      },
    },
  };
}

export function selection(opts: {
  bound: Bound; settings?: RunSettings; roles?: string[]; stored?: StoredRead; versions?: Record<string, ArtifactVersion[] | Error>;
}) {
  const store = memoryStorage(opts.stored);
  const dir = fakeAgents(opts.versions ?? {});
  const changes: Run[] = [];
  const errors: unknown[] = [];
  const plan = resolvePlan(opts.bound, opts.settings, opts.roles ?? []);
  const ctl = new RunSelection({
    plan, storage: store.storage, agents: dir.agents, onRunChanged: (r) => changes.push(r), onError: (e) => errors.push(e),
  });
  return { ctl, plan, store, dir, changes, errors };
}

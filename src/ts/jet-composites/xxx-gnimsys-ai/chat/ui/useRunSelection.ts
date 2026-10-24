import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChatConfig, Run } from "../lib/config/types";
import { EndpointFetch } from "../lib/endpoints/EndpointFetch";
import { OracleAgentDirectory } from "../lib/run/OracleAgentDirectory";
import { resolvePlan } from "../lib/run/plan";
import type { Bound, RunPlan } from "../lib/run/plan";
import { RunSelection } from "../lib/run/selection";
import type { RunState } from "../lib/run/selection";
import { runStorageKey, sessionRunStorage } from "../lib/run/storage";
import type { StoredChoice } from "../lib/run/storage";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";
import DashboardRestHelper = require("xxx-gnimsys-data/rest/dashboard-rest-helper");

export interface RunSelectionView {
  state: RunState;
  plan: RunPlan;
  /** The agent list and the agents' versions (BOSS, through the page's endpoints). */
  directory: OracleAgentDirectory;
  choose(choice: StoredChoice): void;
  openChooser(): void;
  cancel(): void;
}

/**
 * The run selection of the mounted component (design §5.1), for a validated config; null without one. Rebuilt (a new
 * selection, restored from storage again) when what the page bound, the run settings, the user's roles or the endpoints
 * change.
 */
export function useRunSelection(
  config: ChatConfig | null,
  roles: readonly string[],
  restHelper: VbRestHelper | undefined,
  endpointMap: Record<string, string> | undefined,
  onRunChanged: (run: Run) => void,
  onError: (e: unknown) => void,
): RunSelectionView | null {
  const callbacks = useRef({ onRunChanged, onError });
  callbacks.current = { onRunChanged, onError };

  const bound: Bound | null = config === null ? null : {
    ...(config.agent.workflowCode !== undefined && { workflowCode: config.agent.workflowCode }),
    ...(config.agent.version !== undefined && { version: config.agent.version }),
  };
  // Keyed on content: a page may hand an equal config, user or endpoint map again on any property writeback.
  const key = bound === null ? null : JSON.stringify({ bound, settings: config?.ui.runSettings ?? null, roles });
  const endpointKey = JSON.stringify(endpointMap ?? null);

  const selection = useMemo(() => {
    if (bound === null || config === null || restHelper === undefined || endpointMap === undefined) return null;
    const plan = resolvePlan(bound, config.ui.runSettings, roles);
    const directory = new OracleAgentDirectory({ endpoints: new EndpointFetch({ helper: new DashboardRestHelper(restHelper, endpointMap) }) });
    const ctl = new RunSelection({
      plan,
      storage: sessionRunStorage(runStorageKey(window.location.pathname, bound), () => window.sessionStorage),
      agents: directory,
      onRunChanged: (run) => callbacks.current.onRunChanged(run),
      onError: (e) => callbacks.current.onError(e),
    });
    return { ctl, directory };
  }, [key, restHelper, endpointKey]);

  // The state of the current selection; a rebuilt selection shows its own first state at once.
  const [snap, setSnap] = useState<{ ctl: RunSelection; state: RunState } | null>(null);
  useEffect(() => {
    if (selection === null) return undefined;
    const { ctl } = selection;
    setSnap({ ctl, state: ctl.get() });
    const off = ctl.subscribe((state) => setSnap({ ctl, state }));
    void ctl.start();
    return () => {
      off();
      ctl.dispose();
    };
  }, [selection]);

  return useMemo(() => {
    if (selection === null) return null;
    const { ctl, directory } = selection;
    const state = snap !== null && snap.ctl === ctl ? snap.state : ctl.get();
    return {
      state,
      plan: ctl.plan,
      directory,
      choose: (c: StoredChoice) => ctl.choose(c),
      openChooser: () => ctl.openChooser(),
      cancel: () => ctl.cancel(),
    };
  }, [selection, snap]);
}

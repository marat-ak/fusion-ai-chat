import "oj-c/badge";
import "oj-c/button";
import "oj-c/buttonset-single";
import "oj-c/input-text";
import "oj-c/list-item-layout";
import "oj-c/list-view";
import "oj-c/progress-circle";
import "oj-c/truncating-text";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ARTIFACT_VERSIONS } from "../lib/config/types";
import type { ArtifactVersion, Run } from "../lib/config/types";
import { bodyTextOf, errorDetail, isRelogin } from "../lib/errors";
import { AgentListDataProvider } from "../lib/run/AgentListDataProvider";
import type { AgentDirectory, AgentRow } from "../lib/run/OracleAgentDirectory";
import { choosesAgent, choosesVersion, VERSION_LABELS } from "../lib/run/plan";
import type { ChoosePlan } from "../lib/run/plan";
import type { StoredChoice } from "../lib/run/storage";
import { Banner } from "./Banner";
import { AuthBanner } from "./StatePanel";

/** The search runs this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

/** A failed pod read of the panel: the re-login banner for a 401, else what failed and why. */
function Failure(props: { error: unknown; what: string }) {
  if (isRelogin(props.error)) {
    const detail = bodyTextOf(props.error);
    return <AuthBanner class="oj-sm-margin-2x-bottom" state="relogin" {...(detail !== undefined && { detail })} />;
  }
  const d = errorDetail(props.error);
  return <Banner testId="gai-run-error" severity="error" class="oj-sm-margin-2x-bottom" summary={`${props.what} unavailable (${d.status ? "HTTP " + d.status : d.message})`} />;
}

/** Published / Draft as a Redwood segmented control; nothing is selected until the user picks (no default version). */
function VersionChoice(props: { versions: ArtifactVersion[]; value: ArtifactVersion | undefined; onChange: (v: ArtifactVersion) => void }) {
  const items = props.versions.map((v) => ({ value: v, label: VERSION_LABELS[v] }));
  return (
    <oj-c-buttonset-single data-testid="gai-run-version" aria-label="Version" chroming="outlined" items={items}
      {...(props.value !== undefined && { value: props.value })}
      onvalueChanged={(e) => {
        const v = e.detail.value as ArtifactVersion | undefined;
        if (v !== undefined && v !== props.value && props.versions.includes(v)) props.onChange(v);
      }} />
  );
}

/** One agent: its name, its code under it, and a marker per version it has. */
function AgentItem(props: { row: AgentRow }) {
  const { row } = props;
  return (
    <oj-c-list-item-layout data-testid="gai-run-agent" data-workflow-code={row.workflowCode}>
      {/* One fixed default-slot child (the element moves slot nodes into its own layout). */}
      <div class="gai-shrink">
        <oj-c-truncating-text title={row.name} value={row.name} truncation="ellipsis" />
      </div>
      <span slot="secondary" class="oj-typography-body-sm oj-text-color-secondary">{row.workflowCode}</span>
      <div slot="metadata" class="oj-flex oj-sm-flex-wrap-nowrap">
        {row.versions.map((v) => (
          <oj-c-badge key={v} data-testid="gai-run-marker" class="gai-badge oj-sm-margin-1x-start" size="sm"
            variant={v === "DRAFT" ? "warningSubtle" : "successSubtle"} label={VERSION_LABELS[v]} />
        ))}
      </div>
    </oj-c-list-item-layout>
  );
}

/** The agents with `version`, searchable by name or code, paged as the list scrolls; a click picks one. */
function AgentList(props: { directory: AgentDirectory; version: ArtifactVersion; onPick: (workflowCode: string) => void; onFailure: (e: unknown | null) => void }) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [typed]);
  const onFailure = useRef(props.onFailure);
  onFailure.current = props.onFailure;
  const data = useMemo(
    () => new AgentListDataProvider({ directory: props.directory, version: props.version, query, onError: (e) => onFailure.current(e) }),
    [props.directory, props.version, query],
  );
  // Another list (version or search) starts without the last list's failure.
  useEffect(() => { onFailure.current(null); }, [data]);
  const renderRow = useCallback((ctx: { data: AgentRow }) => <AgentItem row={ctx.data} />, []);
  const label = VERSION_LABELS[props.version].toLowerCase();
  const renderNoData = useCallback(() => (
    <div class="oj-typography-body-sm oj-text-color-secondary oj-sm-padding-2x" data-testid="gai-run-no-agents">
      {query === "" ? `No agents have a ${label} version.` : `No agents with a ${label} version match "${query}".`}
    </div>
  ), [query, label]);
  return (
    <>
      <oj-c-input-text data-testid="gai-run-search" class="oj-sm-margin-2x-top" labelHint="Search agents" labelEdge="none"
        placeholder="Search by name or code" clearIcon="conditional" userAssistanceDensity="compact"
        onrawValueChanged={(e) => setTyped(e.detail.value ?? "")} />
      <oj-c-list-view data-testid="gai-run-agents" class="gai-agent-list oj-sm-flex-1 oj-sm-margin-2x-top" aria-label="Agents" data={data}
        gridlines={{ item: "visible" }} onojItemAction={(e) => props.onPick((e.detail.context.data as AgentRow).workflowCode)}>
        <template slot="itemTemplate" render={renderRow} />
        <template slot="noData" render={renderNoData} />
      </oj-c-list-view>
    </>
  );
}

/**
 * The run panel (design §5.1): what the page left to the user, version first — the version (Published / Draft; for a
 * bound agent only the versions it has), then the agents with that version. Shown in place of the chat before the first
 * run and again from the header's "Change" (then with Cancel); every confirmed change starts a new conversation.
 */
export function RunPanel(props: {
  plan: ChoosePlan;
  /** The running run behind the panel (opened from "Change"); null before the first run. */
  current: Run | null;
  note: string | null;
  directory: AgentDirectory;
  onChoose: (choice: StoredChoice) => void;
  /** Present when there is a run to go back to. */
  onCancel?: () => void;
  /** A failed pod read (also shown in the panel). */
  onError: (e: unknown) => void;
}) {
  const { plan, current, directory } = props;
  const agentChoice = choosesAgent(plan);
  const versionChoice = choosesVersion(plan);
  const [version, setVersion] = useState<ArtifactVersion | undefined>(plan.version ?? current?.version);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const onError = useRef(props.onError);
  onError.current = props.onError;
  const fail = useCallback((e: unknown | null) => {
    if (e === null) { setFailure(null); return; }
    setFailure({ error: e });
    onError.current(e);
  }, []);

  // The versions offered: both when the agent is picked after the version; the bound agent's own versions otherwise.
  const [offered, setOffered] = useState<ArtifactVersion[] | null>(versionChoice && agentChoice ? ARTIFACT_VERSIONS.slice() : null);
  const boundAgent = plan.workflowCode;
  useEffect(() => {
    if (!versionChoice || boundAgent === undefined) return undefined;
    let live = true;
    directory.versionsOf(boundAgent).then((v) => { if (live) setOffered(v); }, (e: unknown) => { if (live) fail(e); });
    return () => { live = false; };
  }, [directory, boundAgent, versionChoice, fail]);

  const title = agentChoice && versionChoice ? "Choose a version and an agent" : agentChoice ? "Choose an agent" : "Choose a version";
  const context = boundAgent !== undefined ? `Agent ${boundAgent}` : !versionChoice && version !== undefined ? `${VERSION_LABELS[version]} agents` : undefined;
  // A version the panel may run: fixed, or one of the offered versions.
  const runnable = version !== undefined && (!versionChoice || (offered !== null && offered.includes(version)));

  return (
    <div class="oj-panel oj-sm-padding-0 oj-sm-height-full" data-testid="gai-run-panel">
      <div class="oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-height-full">
        <div class="oj-flex-bar oj-sm-align-items-center oj-sm-padding-2x oj-border-bottom">
          <div class="oj-flex-bar-middle oj-sm-flex-direction-column oj-sm-padding-2x-horizontal">
            <h2 class="oj-typography-heading-xs oj-sm-margin-0" data-testid="gai-run-title">{title}</h2>
            {context !== undefined && <div class="oj-typography-body-sm oj-text-color-secondary" data-testid="gai-run-context">{context}</div>}
          </div>
          {props.onCancel !== undefined && (
            <div class="oj-flex-bar-end">
              <oj-c-button data-testid="gai-run-cancel" size="sm" chroming="borderless" label="Cancel" onojAction={props.onCancel} />
            </div>
          )}
        </div>
        <div class="gai-run-body oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-flex-1 oj-sm-padding-4x-horizontal oj-sm-padding-3x-vertical">
          {props.note !== null && <Banner testId="gai-run-note" severity="warning" class="oj-sm-margin-2x-bottom" summary={props.note} />}
          {failure !== null && <Failure error={failure.error} what={agentChoice ? "Agents" : "Versions"} />}
          {versionChoice && offered === null && failure === null && (
            <div class="oj-flex oj-sm-align-items-center oj-typography-body-sm oj-text-color-secondary" role="status">
              <oj-c-progress-circle class="oj-sm-margin-2x-end" size="sm" value={-1} aria-label="Loading" />Loading versions…
            </div>
          )}
          {versionChoice && offered !== null && offered.length === 0 && (
            <Banner testId="gai-run-no-version" severity="warning" summary={`${boundAgent ?? ""} has no published or draft version you can run`} />
          )}
          {versionChoice && offered !== null && offered.length > 0 && (
            <div>
              <VersionChoice versions={offered} value={version} onChange={setVersion} />
            </div>
          )}
          {versionChoice && offered !== null && offered.length > 0 && !runnable && (
            <div class="oj-typography-body-sm oj-text-color-secondary oj-sm-margin-2x-top" data-testid="gai-run-hint">
              {agentChoice ? "Choose Published or Draft to list the agents." : "Choose the version to run."}
            </div>
          )}
          {agentChoice && runnable && (
            <AgentList key={version} directory={directory} version={version as ArtifactVersion} onFailure={fail}
              onPick={(workflowCode) => props.onChoose({ workflowCode, ...(versionChoice && { version }) })} />
          )}
          {!agentChoice && runnable && (
            <div class="oj-sm-margin-3x-top">
              <oj-c-button data-testid="gai-run-start" chroming="callToAction" label="Start chat" onojAction={() => props.onChoose({ version })} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Nothing bound, and the user may not choose (design §5.1): explicit, never a default agent. No pod call is made. */
export function NoAgentPanel() {
  return (
    <Banner testId="gai-no-agent" severity="warning" summary="No agent in this link">
      <div>This page does not name an agent, and choosing one needs a role you do not hold. Open it from a link that names an agent.</div>
    </Banner>
  );
}

/** A restored choice is being checked against the pod (role still held, agent still listed for that version). */
export function CheckingPanel() {
  return (
    <div class="oj-panel oj-sm-height-full oj-flex oj-sm-justify-content-center oj-sm-align-items-center" data-testid="gai-run-checking" role="status">
      <oj-c-progress-circle class="oj-sm-margin-2x-end" size="sm" value={-1} aria-label="Checking" />
      <span class="oj-typography-body-sm oj-text-color-secondary">Checking your earlier choice…</span>
    </div>
  );
}

// View model of the agent builders' debugger page (debug-host/index.html, spec §17.1): pick one of the user's pod
// instances (no preselect), enter the workflow / app code and the version, Run -> <xxx-gnimsys-ai-chat> over the engine's
// same-origin pod proxy with the debug features on.
import * as ko from "knockout";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import "ojs/ojknockout";
import "oj-c/button";
import "oj-c/form-layout";
import "oj-c/input-text";
import "oj-c/message-banner";
import "oj-c/radioset";
import "oj-c/select-single";
import "xxx-gnimsys-ai/chat/loader";
import { runConfig, runProblems, runUser } from "./debugRun";
import type { RunVersion } from "./debugRun";
import { listPodInstances, POD_PROXY_ENDPOINTS, PodProxyRestHelper } from "./podProxyRestHelper";
import type { PodInstance } from "./podProxyRestHelper";

type Severity = "error" | "warning" | "info";
interface Notice { id: string; severity: Severity; summary: string; detail?: string; closeAffordance: "off" }

/** The props of one Run's <xxx-gnimsys-ai-chat>. */
interface ChatRun {
  config: Record<string, unknown>;
  user: { userName?: string; roles: string[] };
  restHelper: PodProxyRestHelper;
  endpoint: Record<string, string>;
}

const optionLabel = (i: PodInstance): string =>
  `${i.label} — ${!i.connected ? "not signed in" : i.podUser !== undefined ? i.podUser : "pod user unknown"}`;

export class DebugHostViewModel {
  private readonly origin: string;

  readonly instances = ko.observableArray<PodInstance>([]);
  readonly instancesLoaded = ko.observable(false);
  readonly instancesError = ko.observable<string | null>(null);
  readonly loading = ko.observable(false);

  // The page's inputs: nothing preselected (even with a single instance), nothing defaulted.
  readonly instance = ko.observable<string | null>(null);
  readonly workflowCode = ko.observable<string | null>(null);
  readonly appCode = ko.observable<string | null>(null);
  readonly version = ko.observable<RunVersion | null>(null);
  readonly versionOptions = [{ value: "PUBLISHED", label: "Published" }, { value: "DRAFT", label: "Draft" }];

  /** Set by Run while inputs are missing; cleared by a Run that starts. */
  readonly missing = ko.observable<string[]>([]);
  /** The mounted chat; null before the first Run (and for a tick between Runs, so each Run is a fresh chat). */
  readonly chat = ko.observable<ChatRun | null>(null);

  readonly instanceData: ko.PureComputed<ArrayDataProvider<string, { value: string; label: string }>>;
  readonly notices: ko.PureComputed<ArrayDataProvider<string, Notice>>;
  readonly hasNotices: ko.PureComputed<boolean>;

  constructor(options: { origin: string }) {
    this.origin = options.origin;
    this.instanceData = ko.pureComputed(() =>
      new ArrayDataProvider<string, { value: string; label: string }>(this.instances().map((i) => ({ value: i.name, label: optionLabel(i) })), { keyAttributes: "value" }));
    const noticeList = ko.pureComputed((): Notice[] => {
      const out: Notice[] = [];
      const add = (id: string, severity: Severity, summary: string, detail?: string): void => {
        out.push({ id, severity, summary, ...(detail !== undefined && { detail }), closeAffordance: "off" });
      };
      const error = this.instancesError();
      if (error !== null) add("instances", "error", error);
      else if (this.instancesLoaded() && this.instances().length === 0) add("instances", "warning", "No pod instances are available to you.");
      const picked = this.picked();
      if (picked !== null && !picked.connected) add("sign-in", "warning", `Sign in to ${picked.label} through the agent chat, then Refresh.`);
      if (picked !== null && picked.connected && picked.podUser === undefined) {
        add("pod-user", "warning", `The pod user of ${picked.label} is unknown: the chat needs it as its user name.`);
      }
      if (picked !== null && picked.podUsers !== undefined && picked.podUsers.length > 1) {
        add("pod-users", "warning", `You are signed in to ${picked.label} as several pod users (${picked.podUsers.join(", ")}): keep one in the agent chat.`);
      }
      if (picked !== null && picked.missing !== undefined) {
        add("missing-setup", "warning", `${picked.label} is missing setup: ${picked.missing.join(", ")}`, "Calls that need it fail with not-configured.");
      }
      const missing = this.missing();
      if (missing.length > 0) add("missing", "warning", "Run needs more input", missing.join("; "));
      if ((this.appCode() ?? "").trim() !== "") add("app-mode", "info", "Agentic-App mode is not built yet: the chat's mode switch lists it once it is.");
      add("files", "info", "Attachments are off in the debugger: the pod user's PersonId has no reliable read through the FA endpoint yet.");
      return out;
    });
    this.notices = ko.pureComputed(() => new ArrayDataProvider<string, Notice>(noticeList(), { keyAttributes: "id" }));
    this.hasNotices = ko.pureComputed(() => noticeList().length > 0);
  }

  private picked(): PodInstance | null {
    const name = this.instance();
    return name === null ? null : this.instances().find((i) => i.name === name) ?? null;
  }

  /** Lists the user's instances; a picked instance stays picked while it is still listed. */
  readonly loadInstances = (): void => {
    if (this.loading()) return;
    this.loading(true);
    listPodInstances({ origin: this.origin }).then(
      (list) => {
        this.instances(list);
        this.instancesError(null);
        if (this.instance() !== null && !list.some((i) => i.name === this.instance())) this.instance(null);
      },
      (e: unknown) => {
        this.instances([]);
        this.instancesError(e instanceof Error ? e.message : String(e));
        this.instance(null);
      },
    ).finally(() => {
      this.instancesLoaded(true);
      this.loading(false);
    });
  };

  readonly run = (): void => {
    const inputs = { instance: this.picked(), workflowCode: this.workflowCode() ?? "", appCode: this.appCode() ?? "", version: this.version() };
    const problems = runProblems(inputs);
    this.missing(problems);
    if (problems.length > 0) return;
    const instance = inputs.instance as PodInstance;
    const next: ChatRun = {
      config: runConfig({ workflowCode: inputs.workflowCode, appCode: inputs.appCode, version: inputs.version as RunVersion }),
      user: runUser(instance),
      restHelper: new PodProxyRestHelper({ instance: instance.name, label: instance.label, origin: this.origin }),
      endpoint: { ...POD_PROXY_ENDPOINTS },
    };
    // Unmount first: a Run is a new chat (new conversation, no turns carried over), even with the same inputs.
    this.chat(null);
    setTimeout(() => this.chat(next), 0);
  };
}

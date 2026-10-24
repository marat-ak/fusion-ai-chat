// View model of the agent builders' debugger page (debug-host/index.html, spec §17.1; bridge design §4.1). The agent chat
// opens the page bound to one workflow run through its URL (debugRun.ts reads it); the page shows no picker and no input:
// either the chat over the conversation's same-origin pod proxy with the debug features on, or an explicit panel saying
// why there is none.
import * as ko from "knockout";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import "ojs/ojknockout";
import "oj-c/message-banner";
import "xxx-gnimsys-ai/chat/loader";
import { startRun } from "./debugRun";
import type { ChatRun, RunOutcome } from "./debugRun";

type Severity = "error" | "warning" | "info";
interface Notice { id: string; severity: Severity; summary: string; detail?: string; closeAffordance: "off" }

/** The panel of a page opened without a complete binding (the agent UI's header button opens the bare page). */
export const OPEN_FROM_CHAT = "Open the debugger from the chat — ask the agent to debug a workflow";

const banner = (list: Notice[]): ArrayDataProvider<string, Notice> => new ArrayDataProvider<string, Notice>(list, { keyAttributes: "id" });
const notice = (id: string, severity: Severity, summary: string, detail?: string): Notice =>
  ({ id, severity, summary, ...(detail !== undefined && { detail }), closeAffordance: "off" });

export class DebugHostViewModel {
  private readonly origin: string;
  private readonly search: string;

  /** What startRun decided; null until it has. */
  readonly outcome = ko.observable<RunOutcome | null>(null);
  /** The mounted chat's props; null unless the URL binds a run and its pod binding was read. */
  readonly chat: ko.PureComputed<ChatRun | null>;
  /** The bound run in words (workflow, version, instance once known); "" when nothing is bound. */
  readonly bound: ko.PureComputed<string>;
  readonly hasBound: ko.PureComputed<boolean>;
  readonly openFromChat: ko.PureComputed<ArrayDataProvider<string, Notice>>;
  readonly hasOpenFromChat: ko.PureComputed<boolean>;
  readonly notices: ko.PureComputed<ArrayDataProvider<string, Notice>>;
  readonly hasNotices: ko.PureComputed<boolean>;

  constructor(options: { origin: string; search: string }) {
    this.origin = options.origin;
    this.search = options.search;
    // A bare page (no query at all) is the expected header-button case; anything else is a broken binding.
    const bare = [...new URLSearchParams(this.search).keys()].length === 0;
    this.chat = ko.pureComputed(() => {
      const o = this.outcome();
      return o !== null && o.kind === "run" ? o.chat : null;
    });
    this.bound = ko.pureComputed(() => {
      const o = this.outcome();
      if (o === null || o.kind === "open-from-chat") return "";
      const { workflowCode, version } = o.binding;
      return `Workflow ${workflowCode} · ${version}${o.kind === "run" ? ` · ${o.instance}` : ""}`;
    });
    this.hasBound = ko.pureComputed(() => this.bound() !== "");
    const openList = ko.pureComputed((): Notice[] => {
      const o = this.outcome();
      return o !== null && o.kind === "open-from-chat" ? [notice("open-from-chat", bare ? "info" : "error", OPEN_FROM_CHAT, o.problems.join("; "))] : [];
    });
    this.openFromChat = ko.pureComputed(() => banner(openList()));
    this.hasOpenFromChat = ko.pureComputed(() => openList().length > 0);
    const noticeList = ko.pureComputed((): Notice[] => {
      const o = this.outcome();
      if (o === null || o.kind === "open-from-chat") return [];
      if (o.kind === "auth-required") return [notice("sign-in", "warning", "Sign in to the pod through the agent chat, then ask the agent to open the debugger again.")];
      if (o.kind === "unavailable") return [notice("unavailable", "error", o.message)];
      const out: Notice[] = [];
      if (o.podUser === undefined) out.push(notice("pod-user", "warning", `The pod user of ${o.instance} is unknown: the chat needs it as its user name.`));
      out.push(notice("files", "info", "Attachments are off in the debugger: the pod user's PersonId has no reliable read through the FA endpoint yet."));
      return out;
    });
    this.notices = ko.pureComputed(() => banner(noticeList()));
    this.hasNotices = ko.pureComputed(() => noticeList().length > 0);
  }

  /** Reads the URL's binding and, when it binds a run, the conversation's pod binding; once per page load. */
  readonly start = (): Promise<void> => startRun({ search: this.search, origin: this.origin }).then((o) => { this.outcome(o); });
}

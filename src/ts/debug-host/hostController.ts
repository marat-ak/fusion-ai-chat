// View model of the agent builders' debugger page (debug-host/index.html, spec §17.1; bridge design §4.1, §13). The agent
// chat opens the page bound to one workflow run through its URL (debugRun.ts reads it); the page shows no picker and no
// input: either the chat over the conversation's same-origin pod proxy, or an explicit panel saying why there is none.
// With a chat, two tabs: Chat, and Run — the Run Inspector (inspector/Inspector.tsx) over the page's run record
// (run/runStore.ts, the chat's run observer). The page also takes the agent's panel messages (run/panelMessages.ts):
// export, reset (export first on request, then a fresh pod conversation), breakpoints for the next runs.
import * as ko from "knockout";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import "ojs/ojknockout";
import "oj-c/message-banner";
import "oj-c/tab-bar";
import "xxx-gnimsys-ai/chat/loader";
import { startRun } from "./debugRun";
import type { ChatRun, RunOutcome } from "./debugRun";
import { bossDefinitionSource } from "./run/definitionSource";
import type { DefinitionSource } from "./run/definitionSource";
import { buildExport, exportFileName } from "./run/exporter";
import type { ExportBinding } from "./run/exporter";
import { readPanelMessage } from "./run/panelMessages";
import type { PanelMessage } from "./run/panelMessages";
import { RunStore } from "./run/runStore";
import type { VbRestHelper } from "xxx-gnimsys-data/rest/index";

type Severity = "error" | "warning" | "info" | "confirmation";
interface Notice { id: string; severity: Severity; summary: string; detail?: string; closeAffordance: "off" | "on" }

/** The panel of a page opened without a complete binding (the agent UI's header button opens the bare page). */
export const OPEN_FROM_CHAT = "Open the debugger from the chat — ask the agent to debug a workflow";

const banner = (list: Notice[]): ArrayDataProvider<string, Notice> => new ArrayDataProvider<string, Notice>(list, { keyAttributes: "id" });
const notice = (id: string, severity: Severity, summary: string, detail?: string, closeable = false): Notice =>
  ({ id, severity, summary, ...(detail !== undefined && { detail }), closeAffordance: closeable ? "on" : "off" });

/** Hands a file to the browser (the side panel's frame grants downloads). */
export type Download = (fileName: string, text: string) => void;

const browserDownload: Download = (fileName, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export class DebugHostViewModel {
  private readonly origin: string;
  private readonly search: string;
  private readonly download: Download;
  private readonly now: () => number;

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

  /** Every turn the chat runs in this page, and the breakpoints of the next runs (the chat's run observer). */
  readonly runStore = new RunStore();
  /** The Chat / Run tabs. */
  readonly tab = ko.observable<"chat" | "run">("chat");
  readonly tabs: ko.PureComputed<Array<{ itemKey: string; label: string }>>;
  /** What the agent's last panel messages did (exported, reset, breakpoints) or why one was refused; closeable. */
  private readonly events = ko.observableArray<Notice>([]);
  private readonly turnCount = ko.observable(0);
  private readonly breakpoints = ko.observable<readonly string[]>([]);
  private eventSeq = 0;
  private source: DefinitionSource | null = null;

  constructor(options: { origin: string; search: string; download?: Download; now?: () => number }) {
    this.origin = options.origin;
    this.search = options.search;
    this.download = options.download ?? browserDownload;
    this.now = options.now ?? Date.now;
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
      const bp = this.breakpoints();
      if (bp.length > 0) out.push(notice("breakpoints", "info", `Breakpoints: the next runs stop before ${bp.join(", ")}`, "Set by the agent; the Run tab shows them and removes them."));
      return [...out, ...this.events()];
    });
    this.notices = ko.pureComputed(() => banner(noticeList()));
    this.hasNotices = ko.pureComputed(() => noticeList().length > 0);
    this.tabs = ko.pureComputed(() => [
      { itemKey: "chat", label: "Chat" },
      { itemKey: "run", label: this.turnCount() > 0 ? `Run (${this.turnCount()})` : "Run" },
    ]);
    this.runStore.subscribe(() => {
      this.turnCount(this.runStore.turns.length);
      this.breakpoints(this.runStore.breakpoints);
    });
  }

  /** Reads the URL's binding and, when it binds a run, the conversation's pod binding; once per page load. */
  readonly start = (): Promise<void> => startRun({ search: this.search, origin: this.origin }).then((o) => {
    if (o.kind === "run") {
      const source = bossDefinitionSource(o.chat.restHelper as unknown as VbRestHelper, o.chat.endpoint);
      this.source = source;
      // The definition version right after each turn: the saved draft the run most likely executed.
      this.runStore.onTurnEnd = (turn) => {
        source.version(o.binding.workflowCode, o.binding.version).then(
          (r) => this.runStore.setDefinitionVersion(turn, r.ok ? { ...(r.version !== undefined && { version: r.version }) } : { error: r.reason }),
          (e: unknown) => this.runStore.setDefinitionVersion(turn, { error: e instanceof Error ? e.message : String(e) }),
        );
      };
    }
    this.outcome(o);
  });

  /** The definition reader of the bound run (null before start() bound one). */
  definitionSource(): DefinitionSource | null {
    return this.source;
  }

  /** The binding as the export names it; null without a running chat. */
  private exportBinding(): ExportBinding | null {
    const o = this.outcome();
    if (o === null || o.kind !== "run") return null;
    return {
      pod: o.binding.pod, instance: o.instance, ...(o.podUser !== undefined && { podUser: o.podUser }),
      workflowCode: o.binding.workflowCode, version: o.binding.version,
    };
  }

  private event(severity: Severity, summary: string): void {
    this.events([notice(`event-${++this.eventSeq}`, severity, summary, undefined, true)]);
  }

  /** Closes a closeable notice (the banner's close action). */
  readonly closeNotice = (e: { detail: { key: string } }): void => {
    this.events(this.events().filter((n) => n.id !== e.detail.key));
  };

  /** Downloads the debug conversation (every turn of this page) as JSON; returns whether a file was made. */
  readonly exportNow = (): boolean => {
    const binding = this.exportBinding();
    if (binding === null) {
      this.event("error", "Nothing to export: the debugger has no running chat.");
      return false;
    }
    const now = this.now();
    const file = buildExport(this.runStore.turns, binding, this.runStore.breakpoints, now);
    this.download(exportFileName(binding, now), JSON.stringify(file, null, 2));
    const turns = this.runStore.turns.length;
    this.event("confirmation", `Exported ${turns} turn${turns === 1 ? "" : "s"}${file.masked > 0 ? ` (${file.masked} credential value${file.masked === 1 ? "" : "s"} masked)` : ""}.`);
    return true;
  };

  /** The chat element of the page (mounted while a run is bound). */
  private chatElement(): { newConversation(): void } | null {
    const el = document.querySelector("xxx-gnimsys-ai-chat") as unknown as { newConversation?: () => void } | null;
    return el !== null && typeof el.newConversation === "function" ? (el as { newConversation(): void }) : null;
  }

  /** Export first when asked, then a fresh pod conversation (the run record starts over; the breakpoints stay). */
  readonly reset = (exportFirst: boolean): void => {
    const chat = this.chatElement();
    if (chat === null) {
      this.event("error", "Reset refused: the debugger has no running chat.");
      return;
    }
    if (exportFirst && !this.exportNow()) return;
    try {
      chat.newConversation();
    } catch (e) {
      this.event("error", `Reset failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.runStore.clear();
    this.tab("chat");
    this.event("info", exportFirst ? "Exported, then started a fresh conversation." : "Started a fresh conversation (not exported).");
  };

  /** What one of the agent's panel messages does. */
  apply(message: PanelMessage): void {
    switch (message.type) {
      case "export":
        this.exportNow();
        return;
      case "reset":
        this.reset(message.export);
        return;
      case "breakpoints":
        this.runStore.setBreakpoints(message.nodes);
        this.event("info", message.nodes.length > 0 ? `The agent set breakpoints: ${message.nodes.join(", ")}.` : "The agent removed every breakpoint.");
        return;
    }
  }

  /** The page's `message` listener: only the agent UI's panel messages are taken (panelMessages.ts). */
  readonly onWindowMessage = (event: MessageEvent): void => {
    const r = readPanelMessage({ origin: event.origin, source: event.source, data: event.data }, { origin: window.location.origin, parent: window.parent, window });
    if (r.kind === "ignored") return;
    if (r.kind === "refused") {
      this.event("error", `A panel message was refused: ${r.reason}`);
      return;
    }
    this.apply(r.message);
  };
}

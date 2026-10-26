// The agent's messages to the debugger panel (bridge design §13.1): the engine's `ui_side_panel_message` tool becomes a turn
// event, and the agent UI (webc) posts it to this page's frame:
//   window.postMessage({gnimsys: "side-panel-message", id, message: {type, ...fields}}, <own origin>)
// Accepted only from the page's own origin AND from the parent window (the agent UI that frames this page); anything else
// is not ours and ignored. The message types and fields are the ones setup declares for this panel (strings only):
//   {type: "export"}                                  -> download the debug conversation (exporter.ts)
//   {type: "reset", export: "true" | "false"}         -> export first when "true", then a fresh pod conversation
//   {type: "breakpoints", nodes: "" | "<CODE>[,<CODE>…]"} -> the breakpoints of the next /debug runs ("" = none)
// A message of ours with a bad shape is refused with a reason (the page shows it); nothing else is accepted.
import { parseBreakpointNodes } from "./breakpoints";

export const ENVELOPE = "side-panel-message";

export type PanelMessage =
  | { type: "export" }
  | { type: "reset"; export: boolean }
  | { type: "breakpoints"; nodes: string[] };

export type PanelMessageResult =
  | { kind: "ignored" }
  | { kind: "refused"; reason: string }
  | { kind: "ok"; id: string; message: PanelMessage };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads one `message` event: `self` is this page's window (its origin and parent decide what is ours). */
export function readPanelMessage(event: { origin: string; source: unknown; data: unknown }, self: { origin: string; parent: unknown; window: unknown }): PanelMessageResult {
  // Ours only: our own origin, sent by the window that frames us (a page that is not framed has no such sender).
  if (event.origin !== self.origin || self.parent === self.window || event.source !== self.parent) return { kind: "ignored" };
  const d = event.data;
  if (!isObj(d) || d.gnimsys !== ENVELOPE) return { kind: "ignored" };
  if (typeof d.id !== "string" || d.id === "") return { kind: "refused", reason: "the panel message has no id" };
  const m = d.message;
  if (!isObj(m) || typeof m.type !== "string") return { kind: "refused", reason: "the panel message has no message.type" };
  const fields = Object.keys(m).filter((k) => k !== "type");
  const only = (allowed: string[]): string | null => {
    const extra = fields.filter((k) => !allowed.includes(k));
    if (extra.length > 0) return `unknown field${extra.length > 1 ? "s" : ""} ${extra.join(", ")} in "${m.type}"`;
    const missing = allowed.filter((k) => !(k in m));
    if (missing.length > 0) return `"${m.type}" needs ${missing.join(", ")}`;
    const notString = allowed.filter((k) => typeof m[k] !== "string");
    return notString.length > 0 ? `${notString.join(", ")} must be a string in "${m.type}"` : null;
  };
  switch (m.type) {
    case "export": {
      const bad = only([]);
      return bad !== null ? { kind: "refused", reason: bad } : { kind: "ok", id: d.id, message: { type: "export" } };
    }
    case "reset": {
      const bad = only(["export"]);
      if (bad !== null) return { kind: "refused", reason: bad };
      if (m.export !== "true" && m.export !== "false") return { kind: "refused", reason: '"reset" export must be "true" or "false"' };
      return { kind: "ok", id: d.id, message: { type: "reset", export: m.export === "true" } };
    }
    case "breakpoints": {
      const bad = only(["nodes"]);
      if (bad !== null) return { kind: "refused", reason: bad };
      try {
        return { kind: "ok", id: d.id, message: { type: "breakpoints", nodes: parseBreakpointNodes(m.nodes as string) } };
      } catch (e) {
        return { kind: "refused", reason: `"breakpoints" ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    default:
      return { kind: "refused", reason: `unknown panel message type "${m.type}"` };
  }
}

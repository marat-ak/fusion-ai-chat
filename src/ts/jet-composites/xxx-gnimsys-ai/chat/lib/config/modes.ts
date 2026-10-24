import { IMPLEMENTED_MODES } from "./types";
import type { ChatMode, RunConfig } from "./types";

/** What each mode talks to must be configured: the workflow for `chat`/`gnimsys`, the app for `app` (spec §5). */
function configured(config: RunConfig, mode: ChatMode): boolean {
  return mode === "app" ? config.app !== undefined : config.agent.workflowCode !== "";
}

/** The modes the header's switch (`ui.modeSwitch`) lists: implemented AND configured, in spec order. */
export function availableModes(config: RunConfig): ChatMode[] {
  return IMPLEMENTED_MODES.filter((m) => configured(config, m));
}

export const MODE_LABELS: Record<ChatMode, string> = { chat: "Chat", app: "App", gnimsys: "Gnimsys" };

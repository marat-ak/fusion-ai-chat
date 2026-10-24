import { IMPLEMENTED_MODES } from "./types";
import type { ChatConfig, ChatMode } from "./types";

/** What each mode talks to must be configured: the workflow for `chat`/`gnimsys`, the app for `app` (spec §5). */
function configured(config: ChatConfig, mode: ChatMode): boolean {
  return mode === "app" ? config.app !== undefined : config.agent.workflowCode !== "";
}

/** The modes the header's switch (`ui.modeSwitch`) lists: implemented AND configured, in spec order. */
export function availableModes(config: ChatConfig): ChatMode[] {
  return IMPLEMENTED_MODES.filter((m) => configured(config, m));
}

export const MODE_LABELS: Record<ChatMode, string> = { chat: "Chat", app: "App", gnimsys: "Gnimsys" };

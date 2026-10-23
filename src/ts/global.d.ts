// Dev host page only: an e2e test may set the chat config (and the starting conversation id) before the app loads.
interface Window {
  __CHAT_CONFIG__?: object | string;
  __CHAT_CONVERSATION_ID__?: string;
  __CHAT_USER__?: { userName?: string; roles?: string[] };
  __CHAT_ENDPOINTS__?: Record<string, string>;
  __CHAT_REST_HELPER_MODE__?: "none" | "no-stream" | "stream-fails-once";
}

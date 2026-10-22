// Dev host page only: an e2e test may set the chat config (and the starting conversation id) before the app loads.
interface Window {
  __CHAT_CONFIG__?: object | string;
  __CHAT_CONVERSATION_ID__?: string;
  __CHAT_USER_ROLES__?: string[];
}

// Dev host page only: an e2e test may set the chat config before the app loads.
interface Window {
  __CHAT_CONFIG__?: object | string;
}

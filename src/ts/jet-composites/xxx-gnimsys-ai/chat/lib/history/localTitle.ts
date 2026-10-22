/** Sidebar title of a conversation the pod has not named yet: its first user message, shortened as Oracle's chat does. */
export function localTitle(firstMessage: string): string {
  const t = firstMessage.trim();
  return t.length > 45 ? t.slice(0, 42) + "…" : t;
}

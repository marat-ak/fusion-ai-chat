const JSON_FIELDS = ["detail", "title", "message"] as const;

/**
 * Readable one-line text of an HTTP error body: a JSON body's `detail`, `title` or `message` (the first non-empty string
 * of these), else the raw text with HTML tags (and script/style contents) stripped; whitespace collapsed, and cut to
 * `max` characters followed by "…".
 */
export function errorText(body: string, max = 300): string {
  let text: string | undefined;
  try {
    const v: unknown = JSON.parse(body);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      for (const k of JSON_FIELDS) {
        const f = o[k];
        if (typeof f === "string" && f.trim() !== "") { text = f; break; }
      }
    }
  } catch {
    // not JSON: the raw text below
  }
  if (text === undefined) {
    text = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]+>/g, "");
  }
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max) + "…" : one;
}

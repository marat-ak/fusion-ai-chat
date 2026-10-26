// Copy to the clipboard from the inspector; the outcome (copied / why not) goes to whoever listens (the inspector's toast).
type Listener = (outcome: { ok: true; what: string } | { ok: false; why: string }) => void;
const listeners = new Set<Listener>();

export function onCopy(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const tell = (o: Parameters<Listener>[0]): void => { for (const l of [...listeners]) l(o); };

/** Writes `text` to the clipboard (the async Clipboard API; the panel's frame is same-origin). */
export function copy(text: string, what = "Copied"): void {
  const cb = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (cb === undefined || typeof cb.writeText !== "function") {
    tell({ ok: false, why: "the clipboard is not available in this page" });
    return;
  }
  cb.writeText(text).then(
    () => tell({ ok: true, what }),
    (e: unknown) => tell({ ok: false, why: e instanceof Error ? e.message : String(e) }),
  );
}

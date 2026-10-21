/** Explicit origin, else the page origin; throws when neither exists (no "" fallback). */
export function resolveOrigin(explicit?: string): string {
  const origin = explicit ?? (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin) throw new Error("origin unavailable");
  return origin;
}

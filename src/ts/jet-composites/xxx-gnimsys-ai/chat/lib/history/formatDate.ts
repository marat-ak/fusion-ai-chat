let format: Intl.DateTimeFormat | null = null;

/** A conversation's timestamp as a short date and time in the browser locale; "" when it is missing or not a date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (format === null) format = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
  return format.format(d);
}

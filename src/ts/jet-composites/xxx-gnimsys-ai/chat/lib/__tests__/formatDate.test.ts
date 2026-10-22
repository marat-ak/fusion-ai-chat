import { formatDate } from "../history/formatDate";

describe("formatDate", () => {
  it("formats an ISO timestamp as short date and time in the default locale", () => {
    const iso = "2026-10-20T09:05:00.000Z";
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
    expect(formatDate(iso)).toBe(expected);
  });

  it("is empty for a missing value (null, undefined, empty) instead of the epoch", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("is empty for a value that is not a date", () => {
    expect(formatDate("not a date")).toBe("");
  });
});

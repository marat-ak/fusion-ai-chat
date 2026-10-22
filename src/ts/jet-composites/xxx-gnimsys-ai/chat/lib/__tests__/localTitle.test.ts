import { localTitle } from "../history/localTitle";

describe("localTitle", () => {
  it("keeps a message of up to 45 characters", () => {
    const m45 = "x".repeat(45);
    expect(localTitle("Show my invoices")).toBe("Show my invoices");
    expect(localTitle(m45)).toBe(m45);
  });

  it("cuts a longer message to 42 characters plus an ellipsis", () => {
    expect(localTitle("y".repeat(46))).toBe("y".repeat(42) + "…");
  });

  it("trims surrounding whitespace first", () => {
    expect(localTitle("  hello \n")).toBe("hello");
  });
});

import { resolveOrigin } from "../origin";

test("resolveOrigin_prefers_explicit", () => {
  expect(resolveOrigin("https://a.example")).toBe("https://a.example");
});

test("resolveOrigin_uses_location", () => {
  expect(resolveOrigin()).toBe(globalThis.location.origin);
});

test("resolveOrigin_throws_without_both", () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
  try {
    expect(() => resolveOrigin()).toThrow("origin unavailable");
  } finally {
    if (desc) Object.defineProperty(globalThis, "location", desc);
  }
});

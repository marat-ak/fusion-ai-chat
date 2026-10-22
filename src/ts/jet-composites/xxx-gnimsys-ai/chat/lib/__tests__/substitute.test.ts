import { substitute } from "../config/substitute";

test("substitute_replaces_known_keys", () => {
  const out = substitute(
    { org: "{{orgId}}", note: "user {{user}} in {{orgId}}", nested: { list: ["{{user}}", 7, { deep: "{{ orgId }}" }] }, n: 3, b: true, z: null },
    { orgId: 204, user: "ann" },
  );
  expect(out).toEqual({ org: "204", note: "user ann in 204", nested: { list: ["ann", 7, { deep: "204" }] }, n: 3, b: true, z: null });
});

test("substitute_leaves_unknown_literal", () => {
  expect(substitute({ a: "{{missing}} and {{known}}", b: "{{undef}}" }, { known: "k", undef: undefined })).toEqual({
    a: "{{missing}} and k",
    b: "{{undef}}",
  });
});

test("substitute_does_not_mutate", () => {
  const input = { a: "{{x}}", nested: { list: ["{{x}}"] } };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = substitute(input, { x: "1" });
  expect(input).toEqual(snapshot);
  expect(out).not.toBe(input);
  expect(out.nested).not.toBe(input.nested);
  expect((out.nested as { list: unknown[] }).list).not.toBe(input.nested.list);
});

test("substitute_ignores_inherited_keys", () => {
  expect(substitute({ a: "{{constructor}}", b: "{{toString}}", c: "{{own}}" }, { own: "x" })).toEqual({
    a: "{{constructor}}",
    b: "{{toString}}",
    c: "x",
  });
});

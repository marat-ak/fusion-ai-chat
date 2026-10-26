// What a node changed: the difference between two decoded values (decode.ts), e.g. the `$variables` of a node's context
// and of the step before it (a node's context is the state AFTER it ran). Leaves are compared; an object or array that
// appears or disappears whole is one entry.
import { childPath } from "./decode";

export interface Change {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The changes from `before` to `after`, in `after`'s order (removed entries after the kept ones of their parent). */
export function diff(before: unknown, after: unknown, path = "$"): Change[] {
  if (isObj(before) && isObj(after)) {
    const out: Change[] = [];
    for (const k of Object.keys(after)) {
      const p = childPath(path, k);
      if (!(k in before)) out.push({ path: p, kind: "added", after: after[k] });
      else out.push(...diff(before[k], after[k], p));
    }
    for (const k of Object.keys(before)) if (!(k in after)) out.push({ path: childPath(path, k), kind: "removed", before: before[k] });
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: Change[] = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`;
      if (i >= before.length) out.push({ path: p, kind: "added", after: after[i] });
      else if (i >= after.length) out.push({ path: p, kind: "removed", before: before[i] });
      else out.push(...diff(before[i], after[i], p));
    }
    return out;
  }
  return Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, kind: "changed", before, after }];
}

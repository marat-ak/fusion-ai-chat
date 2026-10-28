// The breakpoints survive a reload of the debugger page within the same browser tab: they are about the workflow, not the
// conversation (a reset keeps them too). Kept in sessionStorage under a key of the bound workflow and version, written on
// every change (an empty set removes the key). A restored value is re-checked (node codes only, no duplicates): anything
// else is dropped and named, never used. Storage access is wrapped: a page whose storage throws keeps them in memory only.
import { BREAKPOINT_NODES } from "./breakpoints";

const NODE_CODE = /^[A-Za-z0-9_]+$/;

/** The storage key of a bound run's breakpoints. */
export function breakpointKey(workflowCode: string, version: string): string {
  return `xxx-gnimsys-ai-debug:breakpoints:${workflowCode}:${version}`;
}

/** The page's sessionStorage, or null when it is unavailable (private windows and blocked storage can throw). */
export function sessionStore(): Storage | null {
  try {
    const s = window.sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export type RestoredBreakpoints = { codes: string[]; dropped: string | null };

/** The stored breakpoints of `key`: null when nothing is stored (or storage is unavailable). */
export function readBreakpoints(storage: Storage | null, key: string): RestoredBreakpoints | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { codes: [], dropped: "the stored value is not JSON" };
  }
  if (!Array.isArray(v)) return { codes: [], dropped: "the stored value is not a list" };
  const codes: string[] = [];
  const bad: string[] = [];
  for (const c of v) {
    if (typeof c === "string" && NODE_CODE.test(c) && !codes.includes(c)) codes.push(c);
    else bad.push(JSON.stringify(c));
  }
  return { codes, dropped: bad.length > 0 ? `not node codes or repeated: ${bad.join(", ")}` : null };
}

/** Stores the breakpoints (an empty set removes the key); a failing storage is reported to the caller (returns false). */
export function writeBreakpoints(storage: Storage | null, key: string, codes: readonly string[]): boolean {
  if (storage === null) return false;
  if (codes.join(",") !== "" && !BREAKPOINT_NODES.test(codes.join(","))) throw new Error("writeBreakpoints: not node codes");
  try {
    if (codes.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(codes));
    return true;
  } catch {
    return false;
  }
}

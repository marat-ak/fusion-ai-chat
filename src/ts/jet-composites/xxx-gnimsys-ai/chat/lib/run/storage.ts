// The user's run choice survives a page refresh in the tab's sessionStorage (design §5.1): only the parts the user chose
// (never a bound part), under a key scoped to the page and to what the page bound, so two pages with different links never
// share a choice. Run choices only, never conversations. Every storage access may throw (private windows, blocked site
// data): a failing read is "nothing stored" (the picker shows), a failing write or remove is skipped.
import { ARTIFACT_VERSIONS } from "../config/types";
import type { ArtifactVersion } from "../config/types";
import type { Bound } from "./plan";

export const RUN_STORAGE_PREFIX = "xxx-gnimsys-ai-chat:run:";

/** The parts of a run the user chose. */
export interface StoredChoice { workflowCode?: string; version?: ArtifactVersion }

export type StoredRead = { kind: "none" } | { kind: "unreadable" } | { kind: "choice"; choice: StoredChoice };

export interface RunStorage {
  read(): StoredRead;
  write(choice: StoredChoice): void;
  remove(): void;
}

/**
 * `xxx-gnimsys-ai-chat:run:<pathname>:agent=<bound code or ->,version=<bound version or ->`, e.g.
 * `xxx-gnimsys-ai-chat:run:/main-start:agent=-,version=-` for a page that binds nothing.
 */
export function runStorageKey(pathname: string, bound: Bound): string {
  return `${RUN_STORAGE_PREFIX}${pathname}:agent=${bound.workflowCode ?? "-"},version=${bound.version ?? "-"}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored value as written by write(): an object of the two optional parts and nothing else; null for anything else. */
export function parseStoredChoice(raw: string): StoredChoice | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || Object.keys(v).some((k) => k !== "workflowCode" && k !== "version")) return null;
  const { workflowCode, version } = v;
  if (workflowCode !== undefined && (typeof workflowCode !== "string" || workflowCode === "")) return null;
  if (version !== undefined && !(ARTIFACT_VERSIONS as readonly unknown[]).includes(version)) return null;
  return { ...(workflowCode !== undefined && { workflowCode }), ...(version !== undefined && { version: version as ArtifactVersion }) };
}

/** The run storage over the tab's sessionStorage; `storage` is called on every access, as reaching it may throw too. */
export function sessionRunStorage(key: string, storage: () => Storage): RunStorage {
  return {
    read() {
      let raw: string | null;
      try {
        raw = storage().getItem(key);
      } catch {
        return { kind: "none" };
      }
      if (raw === null) return { kind: "none" };
      const choice = parseStoredChoice(raw);
      return choice === null ? { kind: "unreadable" } : { kind: "choice", choice };
    },
    write(choice) {
      try {
        storage().setItem(key, JSON.stringify(choice));
      } catch {
        // Without storage the choice is not kept: the next load shows the picker.
      }
    },
    remove() {
      try {
        storage().removeItem(key);
      } catch {
        // Nothing to drop where nothing could be stored.
      }
    },
  };
}

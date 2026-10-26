// Oracle's debug frames nest JSON inside JSON strings (`nodeInput`, `nodeOutput`, `nodeContext`, a call's `input`/`output`,
// and a function call's `response` once more), and cut a value longer than 10 000 characters to its first 10 000 +
// "....." (then it no longer parses: cut, not malformed). decode() turns such a value into plain JSON with every
// JSON-looking string decoded (to MAX_DEPTH levels) and records where it decoded or found a cut; tree() turns the result
// into the rows the inspector's JSON tree shows.

/** How deep strings inside strings are decoded (Oracle's deepest is 2: a function call's response). */
export const MAX_DEPTH = 3;
/** Oracle's cut: the first 10 000 characters of a longer value, then this marker. */
export const CUT_MARK = ".....";
const CUT_AT = 10000;

/** A value Oracle cut (it is kept as text). */
export function isCut(s: string): boolean {
  return s.length === CUT_AT + CUT_MARK.length && s.endsWith(CUT_MARK);
}

/** A string that should be JSON (an object or an array literal). */
function looksJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

export interface Decoded {
  value: unknown;
  /** Paths ("$" root, ".key", "[i]") whose string value was decoded as JSON. */
  decodedPaths: Set<string>;
  /** Paths whose string value Oracle cut. */
  cutPaths: Set<string>;
}

/** Decodes `raw` (any JSON value or a JSON string) to plain JSON; strings that are not JSON stay strings. */
export function decode(raw: unknown): Decoded {
  const decodedPaths = new Set<string>();
  const cutPaths = new Set<string>();
  const walk = (v: unknown, path: string, depth: number): unknown => {
    if (typeof v === "string") {
      if (isCut(v)) { cutPaths.add(path); return v; }
      if (depth < MAX_DEPTH && looksJson(v)) {
        try {
          const parsed: unknown = JSON.parse(v);
          decodedPaths.add(path);
          return walk(parsed, path, depth + 1);
        } catch {
          return v;
        }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, depth));
    if (v !== null && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x, childPath(path, k), depth);
      return o;
    }
    return v;
  };
  return { value: walk(raw, "$", 0), decodedPaths, cutPaths };
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** A child's path: `$.key`, or `$["odd key"]` when the key is not an identifier. */
export function childPath(path: string, key: string): string {
  return IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

export type TreeKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "cut";

/** One row of the JSON tree. */
export interface TreeItem {
  /** The value's path (unique: the tree's key). */
  path: string;
  /** The key (or `[i]`) under its parent; "$" at the root. */
  label: string;
  kind: TreeKind;
  /** A leaf's value as shown (strings unquoted); an object's/array's size ("{3}", "[25]"). */
  text: string;
  /** This value came from a JSON string (decoded). */
  decoded: boolean;
  children?: TreeItem[];
}

/** The tree of a decoded value (`decode()` result). */
export function tree(d: Decoded, rootLabel = "$"): TreeItem {
  const build = (v: unknown, path: string, label: string): TreeItem => {
    const decoded = d.decodedPaths.has(path);
    if (typeof v === "string") {
      return { path, label, kind: d.cutPaths.has(path) ? "cut" : "string", text: v, decoded };
    }
    if (typeof v === "number") return { path, label, kind: "number", text: String(v), decoded };
    if (typeof v === "boolean") return { path, label, kind: "boolean", text: String(v), decoded };
    if (v === null || v === undefined) return { path, label, kind: "null", text: "null", decoded };
    if (Array.isArray(v)) {
      return { path, label, kind: "array", text: `[${v.length}]`, decoded, children: v.map((x, i) => build(x, `${path}[${i}]`, `[${i}]`)) };
    }
    const entries = Object.entries(v as Record<string, unknown>);
    return {
      path, label, kind: "object", text: `{${entries.length}}`, decoded,
      children: entries.map(([k, x]) => build(x, childPath(path, k), k)),
    };
  };
  return build(d.value, "$", rootLabel);
}

/** The value at a path of a decoded value (paths as decode()/tree() write them); undefined when absent. */
export function valueAt(d: Decoded, path: string): unknown {
  if (path === "$") return d.value;
  const re = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/gy;
  let v: unknown = d.value;
  re.lastIndex = 1;
  let m: RegExpExecArray | null;
  while (re.lastIndex < path.length && (m = re.exec(path)) !== null) {
    if (v === null || typeof v !== "object") return undefined;
    const key = m[1] ?? (m[2] !== undefined ? Number(m[2]) : JSON.parse(m[3] as string) as string);
    v = (v as Record<string | number, unknown>)[key];
  }
  return v;
}

/** Every path whose label or text contains `query` (case-insensitive), in tree order. */
export function search(item: TreeItem, query: string): string[] {
  const q = query.toLowerCase();
  if (q === "") return [];
  const out: string[] = [];
  const walk = (t: TreeItem): void => {
    if (t.label.toLowerCase().includes(q) || (t.children === undefined && t.text.toLowerCase().includes(q))) out.push(t.path);
    t.children?.forEach(walk);
  };
  walk(item);
  return out;
}

/** A value as text for copying: strings as they are, everything else as indented JSON. */
export function copyText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? String(v);
}

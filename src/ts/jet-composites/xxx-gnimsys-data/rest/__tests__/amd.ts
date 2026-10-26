// Test helper (not a test file): loads this pack's AMD modules from source the way RequireJS resolves them, so the moved
// dashboard JavaScript is tested exactly as shipped (no transpile, no rewrite).
import * as fs from "fs";
import * as path from "path";

const PACK_ID = "xxx-gnimsys-data";
const PACK_DIR = path.resolve(__dirname, "..", "..");

type Factory = (...deps: unknown[]) => unknown;
const cache = new Map<string, unknown>();

/** "./x" and "../x" relative to the requiring module's id; "xxx-gnimsys-data/x" absolute within the pack. */
function resolveId(id: string, parentId: string | null): string {
  if (id.startsWith("./") || id.startsWith("../")) {
    if (parentId === null) throw new Error(`relative module id without a parent: ${id}`);
    return path.posix.normalize(path.posix.join(path.posix.dirname(parentId), id));
  }
  return id;
}

function fileOf(id: string): string {
  if (!id.startsWith(PACK_ID + "/")) throw new Error(`module outside the pack: ${id}`);
  return path.join(PACK_DIR, id.slice(PACK_ID.length + 1) + ".js");
}

/** Registers a stand-in for a module outside the pack (a JET module such as ojs/ojrestdataprovider). */
export function stubAmd(id: string, value: unknown): void {
  cache.set(id, value);
}

export function loadAmd(id: string, parentId: string | null = null): unknown {
  const full = resolveId(id, parentId);
  if (cache.has(full)) return cache.get(full);
  const src = fs.readFileSync(fileOf(full), "utf8");
  let defined = false;
  let value: unknown;
  const define = (...args: unknown[]): void => {
    // define(factory) | define(deps, factory) | define(id, deps, factory)
    const factory = args[args.length - 1];
    const deps = args.length >= 2 && Array.isArray(args[args.length - 2]) ? (args[args.length - 2] as string[]) : [];
    value = typeof factory === "function" ? (factory as Factory)(...deps.map((d) => loadAmd(d, full))) : factory;
    defined = true;
  };
  (define as unknown as { amd: object }).amd = {};
  new Function("define", src)(define);
  if (!defined) throw new Error(`${full} did not call define()`);
  cache.set(full, value);
  return value;
}

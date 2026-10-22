import { parseConfigProp, validateConfig } from "./validate";
import type { Problem, ValidateResult } from "./types";

export type ChatUser = { userName?: string; roles?: string[]; [k: string]: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Config validation plus the required element properties; nothing is fetched until this passes. */
export function checkInputs(configProp: object | string | undefined, user: ChatUser | undefined, personId: string | undefined): ValidateResult {
  const parsed = parseConfigProp(configProp);
  const result = validateConfig(parsed);
  const missing: Problem[] = [];
  const invalid: Problem[] = [];
  if (typeof user?.userName !== "string" || user.userName === "") missing.push({ path: "user.userName", message: "required" });
  const roles = user?.roles;
  if (roles !== undefined && !(Array.isArray(roles) && roles.every((r) => typeof r === "string"))) {
    invalid.push({ path: "user.roles", message: "must be an array of strings" });
  }
  const files = isObj(parsed) ? parsed.files : undefined;
  if (isObj(files) && files.enabled === true && !personId) missing.push({ path: "person-id", message: "required when files.enabled" });
  if (missing.length === 0 && invalid.length === 0) return result;
  const extra = [...invalid, ...missing];
  if (result.ok) return { ok: false, kind: invalid.length > 0 ? "invalid" : "needs-input", problems: extra };
  return { ok: false, kind: invalid.length > 0 ? "invalid" : result.kind, problems: [...result.problems, ...extra] };
}

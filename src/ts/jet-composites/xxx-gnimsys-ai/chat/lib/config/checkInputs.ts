import { parseConfigProp, validateConfig } from "./validate";
import type { Problem, ValidateResult } from "./types";
import { ENDPOINT_NAMES } from "../endpoints/EndpointFetch";
import { isRunObserver } from "../debug/RunObserver";
import type { EndpointName } from "../endpoints/EndpointFetch";

export type ChatUser = { userName?: string; roles?: string[]; [k: string]: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The endpoints a config calls: FUAI (chat, messages) and BOSS (conversations, workflow) always; FA for attachments. */
function neededEndpoints(filesEnabled: boolean): Array<{ name: EndpointName; message: string }> {
  return [
    { name: "FUAI", message: "required" },
    { name: "BOSS", message: "required" },
    ...(filesEnabled ? [{ name: "FA" as const, message: "required when files.enabled" }] : []),
  ];
}

/** Config validation plus the required element properties; nothing is fetched until this passes. */
export function checkInputs(
  configProp: object | string | undefined,
  user: ChatUser | undefined,
  personId: string | undefined,
  restHelper: unknown,
  endpoint: unknown,
  runObserver?: unknown,
): ValidateResult {
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
  const filesEnabled = isObj(files) && files.enabled === true;
  // Optional (Studio's own clients send none on /debug): absent = the conversation row is created without PersonId.
  if (personId !== undefined && (typeof personId !== "string" || personId === "")) {
    invalid.push({ path: "person-id", message: "must be a non-empty string when given" });
  }
  if (runObserver !== undefined && runObserver !== null && !isRunObserver(runObserver)) {
    invalid.push({ path: "run-observer", message: "must be an object with breakPoints() and turn() (debug hosts)" });
  }

  // Every call goes through the page's rest helper and endpoint map (VB service connections own the requests).
  if (restHelper === undefined || restHelper === null) missing.push({ path: "rest-helper", message: "required" });
  else if (typeof (restHelper as { get?: unknown }).get !== "function") {
    invalid.push({ path: "rest-helper", message: "must be a VB RestHelper (get(endpointId))" });
  }
  if (endpoint !== undefined && endpoint !== null && !isObj(endpoint)) {
    invalid.push({ path: "endpoint", message: "must be an object: endpoint name -> VB endpoint id" });
  } else {
    const map = isObj(endpoint) ? endpoint : {};
    for (const [name, id] of Object.entries(map)) {
      if (!(ENDPOINT_NAMES as readonly string[]).includes(name)) {
        invalid.push({ path: `endpoint.${name}`, message: `unknown endpoint name (${ENDPOINT_NAMES.join(", ")})` });
      } else if (typeof id !== "string" || id === "") {
        invalid.push({ path: `endpoint.${name}`, message: "must be a non-empty string" });
      }
    }
    for (const need of neededEndpoints(filesEnabled)) {
      if (!(need.name in map)) missing.push({ path: `endpoint.${need.name}`, message: need.message });
    }
  }

  if (missing.length === 0 && invalid.length === 0) return result;
  const extra = [...invalid, ...missing];
  if (result.ok) return { ok: false, kind: invalid.length > 0 ? "invalid" : "needs-input", problems: extra };
  return { ok: false, kind: invalid.length > 0 ? "invalid" : result.kind, problems: [...result.problems, ...extra] };
}

// Which run a page shows, from what it bound at init and the roles the user holds (design §5.1, row by row):
//
//   | Bound at init   | User holds          | Shown                                                  |
//   | agent + version | —                   | no choice; runs it (no role check)                     |
//   | agent only      | draft role          | version choice limited to the versions that agent has  |
//   | agent only      | no draft role       | runs Published                                         |
//   | version only    | all-agents role     | agent list for that version                            |
//   | nothing         | all-agents + draft  | version -> refreshed agent list -> agent               |
//   | nothing         | all-agents only     | Published agent list -> agent                          |
//   | nothing / version only | no all-agents role | explicit panel "No agent in this link"           |
//
// Roles only gate CHOOSING: a bound part is never checked against a role nor overridden. PUBLISHED is supplied here, and
// only for the two rows that say so (agent only without the draft role; nothing bound with the all-agents role only).
import type { ArtifactVersion, Run, RunSettings } from "../config/types";

/** What the page bound at init (`config.agent`); an absent part is the user's to choose, as the roles allow. */
export interface Bound { workflowCode?: string; version?: ArtifactVersion }

/**
 * The user chooses the parts left undefined; a defined part is fixed (bound by the page, or PUBLISHED for a user who may
 * not run drafts).
 */
export interface ChoosePlan { kind: "choose"; workflowCode?: string; version?: ArtifactVersion }

export type RunPlan = { kind: "run"; run: Run } | ChoosePlan | { kind: "no-agent" };

/** The user holds at least one of the roles (exact, case-sensitive match). */
export function holdsAny(userRoles: readonly string[], roles: readonly string[]): boolean {
  return userRoles.some((r) => roles.includes(r));
}

export function resolvePlan(bound: Bound, settings: RunSettings | undefined, userRoles: readonly string[]): RunPlan {
  const allAgents = settings !== undefined && holdsAny(userRoles, settings.allAgentsRoles);
  const drafts = settings !== undefined && holdsAny(userRoles, settings.draftRoles);
  const { workflowCode, version } = bound;
  if (workflowCode !== undefined && version !== undefined) return { kind: "run", run: { workflowCode, version } };
  if (workflowCode !== undefined) {
    return drafts ? { kind: "choose", workflowCode } : { kind: "run", run: { workflowCode, version: "PUBLISHED" } };
  }
  if (!allAgents) return { kind: "no-agent" };
  if (version !== undefined) return { kind: "choose", version };
  return drafts ? { kind: "choose" } : { kind: "choose", version: "PUBLISHED" };
}

/** What a choose plan leaves to the user. */
export const choosesAgent = (plan: ChoosePlan): boolean => plan.workflowCode === undefined;
export const choosesVersion = (plan: ChoosePlan): boolean => plan.version === undefined;

export const VERSION_LABELS: Record<ArtifactVersion, string> = { PUBLISHED: "Published", DRAFT: "Draft" };

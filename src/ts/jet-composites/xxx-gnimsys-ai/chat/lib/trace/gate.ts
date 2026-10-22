/** The trace panel is open for a user holding at least one configured role (case-sensitive). No roles given = closed. */
export function traceGateOpen(trace: { roles: string[] } | undefined, userRoles: readonly string[] | undefined): boolean {
  if (trace === undefined || userRoles === undefined) return false;
  return userRoles.some((r) => trace.roles.includes(r));
}

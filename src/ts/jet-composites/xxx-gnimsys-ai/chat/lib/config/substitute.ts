const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

function subst(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (whole: string, raw: string) => {
      const key = raw.trim();
      // Own keys only: `{{constructor}}` must not resolve to Object.prototype members.
      if (!Object.prototype.hasOwnProperty.call(ctx, key)) return whole;
      const v = ctx[key];
      return v === undefined ? whole : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => subst(v, ctx));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = subst(v, ctx);
    return out;
  }
  return value;
}

/** Returns a copy of `obj` with `{{key}}` in every string value replaced by `String(ctx[key])`; unresolved keys stay literal. */
export function substitute(obj: Record<string, unknown>, ctx: Record<string, unknown>): Record<string, unknown> {
  return subst(obj, ctx) as Record<string, unknown>;
}

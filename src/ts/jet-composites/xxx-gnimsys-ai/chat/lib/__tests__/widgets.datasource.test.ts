import { inlineRefusal, sourceRefusal, validateDataSource, validateSourceFields } from "../widgets/datasource";
import type { DataSourceDef } from "../widgets/datasource";
import type { Problem } from "../config/types";
import { validateConfig } from "../config/validate";

const ds: DataSourceDef = { type: "rest", target: "FA", method: "GET", url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=OrganizationCode='M1'" };
const policy = { allowInline: true, allowPrefixes: ["/fscmRestApi/resources/"], pageSize: 25 };

describe("datasource gating (D7)", () => {
  test("inline_is_refused_unless_allowInline_and_a_matching_prefix", () => {
    expect(inlineRefusal(ds, { ...policy, allowInline: false })).toBe("datasource not allowed: datasources.allowInline is off");
    expect(inlineRefusal(ds, { ...policy, allowPrefixes: [] })).toMatch(/^datasource not allowed: .* is not under datasources.allowPrefixes$/);
    expect(inlineRefusal(ds, { ...policy, allowPrefixes: ["/hcmRestApi/"] })).toMatch(/not under/);
    expect(inlineRefusal(ds, { ...policy, allowPrefixes: ["/hcmRestApi/", "/fscmRestApi/resources/"] })).toBeNull();
    // An empty prefix never matches (it would allow every path).
    expect(inlineRefusal(ds, { ...policy, allowPrefixes: [""] })).toMatch(/not under/);
  });

  test("only_GET_and_map_transforms_are_served_by_the_provider", () => {
    expect(sourceRefusal(ds)).toBeNull();
    expect(sourceRefusal({ ...ds, dataTransform: { type: "map", expression: "items" } })).toBeNull();
    expect(sourceRefusal({ ...ds, method: "POST", body: { q: 1 } })).toBe("datasource method POST is not supported by the select datasource (GET only)");
    expect(sourceRefusal({ ...ds, dataTransform: { type: "lodash", expression: "$data.get('items')" } })).toBe('dataTransform "lodash" is not supported by the chat (no expression evaluation)');
  });
});

describe("validateDataSource", () => {
  const check = (v: unknown): string[] => {
    const problems: Problem[] = [];
    validateDataSource(v, "ds", problems);
    return problems.map((p) => `${p.path}: ${p.message}`);
  };

  test("accepts_the_dashboard_shape", () => {
    const problems: Problem[] = [];
    const out = validateDataSource({ ...ds, headers: { Accept: "application/json" }, body: { q: 1 }, dataTransform: { type: "map", expression: "items" } }, "ds", problems);
    expect(problems).toEqual([]);
    expect(out).toEqual({ ...ds, headers: { Accept: "application/json" }, body: { q: 1 }, dataTransform: { type: "map", expression: "items" } });
  });

  test("refuses_other_types_targets_methods_urls_and_keys", () => {
    expect(check({ ...ds, type: "sql" })).toContain('ds.type: must be "rest"');
    expect(check({ ...ds, target: "OTHER" })).toContain("ds.target: must be one of FA, FUAI, BOSS, SAASBATCH, KM, SALESCOMMON");
    expect(check({ ...ds, method: "FETCH" })).toContain("ds.method: must be one of GET, POST, PUT, PATCH, DELETE");
    expect(check({ ...ds, url: "https://evil.example.com/x" })).toContain("ds.url: must be a pod path starting with /");
    expect(check({ ...ds, cacheTimeout: 5 })).toContain("ds.cacheTimeout: unknown key");
    expect(check({ ...ds, dataTransform: { type: "js", expression: "x" } })).toContain('ds.dataTransform.type: must be "lodash" or "map"');
    expect(check("x")).toEqual(["ds: must be an object"]);
  });

  test("source_fields_and_search_template", () => {
    const problems: Problem[] = [];
    expect(validateSourceFields({ valueField: "Code", labelField: "Name", searchTemplate: { minChars: 2 } }, "f", problems)).toEqual({ valueField: "Code", labelField: "Name", searchTemplate: { minChars: 2 } });
    expect(validateSourceFields({ valueField: "Code", labelField: "Name" }, "f", problems)).toEqual({ valueField: "Code", labelField: "Name" });
    expect(validateSourceFields({ valueField: "Code", labelField: "Name", searchField: "Alias" }, "f", problems)).toEqual({ valueField: "Code", labelField: "Name", searchField: "Alias" });
    expect(problems).toEqual([]);
    validateSourceFields({ valueField: "", labelField: "Name", searchField: 3, searchTemplate: { debounceMs: 1.5, x: 1 } }, "f", problems);
    expect(problems.map((p) => `${p.path}: ${p.message}`)).toEqual([
      "f.valueField: must be a non-empty string",
      "f.searchField: must be a non-empty string",
      "f.searchTemplate.x: unknown key",
      "f.searchTemplate.debounceMs: must be a non-negative integer",
    ]);
  });
});

describe("config datasources + widgets overlay", () => {
  const min = { mode: "chat", agent: { workflowCode: "WF_1" }, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" } };

  test("pageSize_defaults_to_25_and_must_be_a_positive_integer", () => {
    const r = validateConfig(min);
    expect(r.ok && r.config.datasources).toEqual({ allowInline: false, allowPrefixes: [], pageSize: 25 });
    const r2 = validateConfig({ ...min, datasources: { pageSize: 50 } });
    expect(r2.ok && r2.config.datasources.pageSize).toBe(50);
    const bad = (v: unknown) => { const x = validateConfig({ ...min, datasources: { pageSize: v } }); return x.ok ? [] : x.problems.map((p) => `${p.path}: ${p.message}`); };
    expect(bad(0)).toContain("datasources.pageSize: must be a positive number");
    expect(bad(2.5)).toContain("datasources.pageSize: must be an integer");
  });

  test("a_valid_overlay_is_carried_as_the_widget_datasource", () => {
    const r = validateConfig({ ...min, widgets: { destSubinv: { fields: { subinv: { dataSource: ds, valueField: "Code", labelField: "Name", searchField: "Alias", searchTemplate: { minChars: 2 } } } } } });
    expect(r.ok && r.config.widgets).toEqual({ destSubinv: { fields: { subinv: { dataSource: ds, valueField: "Code", labelField: "Name", searchField: "Alias", searchTemplate: { minChars: 2 } } } } });
  });

  test("overlay_problems_are_config_errors", () => {
    const paths = (v: unknown): string[] => {
      const r = validateConfig({ ...min, widgets: v });
      return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
    };
    expect(paths({ "bad id": { fields: {} } })).toContain("widgets.bad id: widget id must match [A-Za-z0-9_-]{1,64}");
    expect(paths({ w: { renderer: "x", fields: {} } })).toContain("widgets.w.renderer: unknown key");
    expect(paths({ w: {} })).toContain("widgets.w.fields: must be an object");
    expect(paths({ w: { fields: { f: { dataSource: ds } } } })).toContain("widgets.w.fields.f.valueField: must be a non-empty string");
    expect(paths({ w: { fields: { f: { dataSource: { ...ds, target: "X" }, valueField: "a", labelField: "b" } } } })).toContain("widgets.w.fields.f.dataSource.target: must be one of FA, FUAI, BOSS, SAASBATCH, KM, SALESCOMMON");
    expect(paths({ w: { fields: { f: { dataSource: ds, valueField: "a", labelField: "b", dependsOn: "x" } } } })).toContain("widgets.w.fields.f.dependsOn: unknown key");
  });
});

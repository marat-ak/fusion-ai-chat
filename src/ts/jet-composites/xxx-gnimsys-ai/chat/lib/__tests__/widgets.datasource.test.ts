import { BIP_SERVICE_PATH, checkSource, inlineRefusal, podPathOf, sourceRefusal, validateDataSource, validateSourceFields } from "../widgets/datasource";
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
    expect(check({ ...ds, type: "sql" })).toContain('ds.type: must be "rest" or "BIPReport"');
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

describe("BIPReport datasource (rev 5)", () => {
  const report: DataSourceDef = {
    type: "BIPReport", target: "FA", reportName: "/Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo", recordsetSelector: "DATA_DS", recordSelector: "G_1",
    columns: [{ name: "VENDOR_SITE_ID", type: 2 }, { name: "SITE_LABEL" }, { name: "SITE_CODE", type: 1 }],
    parameters: [{ name: "P_BU_NAME", value: "US1" }, { name: "P_TYPES", value: ["A", 2] }], searchParam: "P_SEARCH",
  };
  const check = (v: unknown): string[] => {
    const problems: Problem[] = [];
    validateDataSource(v, "ds", problems);
    return problems.map((p) => `${p.path}: ${p.message}`);
  };

  test("accepts_the_explicit_report_shape", () => {
    const problems: Problem[] = [];
    expect(validateDataSource(report, "ds", problems)).toEqual(report);
    expect(problems).toEqual([]);
    const { parameters: _p, searchParam: _s, ...bare } = report;
    expect(validateDataSource(bare, "ds", problems)).toEqual(bare);
  });

  test("every_required_input_is_explicit_and_checked", () => {
    const { reportName: _r, ...noPath } = report;
    expect(check(noPath)).toContain("ds.reportName: must be the report's absolute catalog path, /…/NAME.xdo");
    expect(check({ ...report, reportName: "Custom/x.xdo" })).toContain("ds.reportName: must be the report's absolute catalog path, /…/NAME.xdo");
    const { target: _t, ...noTarget } = report;
    expect(check(noTarget)).toContain('ds.target: must be "FA" (the report service is a pod path of the FA endpoint)');
    expect(check({ ...report, target: "BOSS" })).toContain('ds.target: must be "FA" (the report service is a pod path of the FA endpoint)');
    expect(check({ ...report, recordSelector: "" })).toContain("ds.recordSelector: must be a non-empty string");
    expect(check({ ...report, columns: [] })).toContain("ds.columns: must be a non-empty array");
    expect(check({ ...report, columns: [{ name: "A", type: 12 }] })).toContain("ds.columns[0].type: must be 1 (text) or 2 (number)");
    expect(check({ ...report, columns: [{ name: "A" }, { name: "A" }] })).toContain('ds.columns[1].name: duplicate column "A"');
    expect(check({ ...report, parameters: [{ name: "P" }] })).toContain("ds.parameters[0].value: must be a string, a number or a non-empty array of them");
    expect(check({ ...report, parameters: [{ name: "P", value: [] }] })).toContain("ds.parameters[0].value: must be a string, a number or a non-empty array of them");
    expect(check({ ...report, parameters: [{ name: "P", value: "a", defaultValue: "b" }] })).toContain("ds.parameters[0].defaultValue: unknown key");
    expect(check({ ...report, parameters: [{ name: "P", value: "a" }, { name: "P", value: "b" }] })).toContain('ds.parameters[1].name: duplicate parameter "P"');
    expect(check({ ...report, searchParam: "P_BU_NAME" })).toContain('ds.searchParam: "P_BU_NAME" is also a fixed parameter');
    // The dashboard's discovery / sql / tree keys are not part of the chat's shape.
    expect(check({ ...report, datasetName: "G_1" })).toContain("ds.datasetName: unknown key");
    expect(check({ ...report, filterMode: "server" })).toContain("ds.filterMode: unknown key");
    expect(check({ ...report, type: "sql" })).toContain('ds.type: must be "rest" or "BIPReport"');
  });

  test("an_inline_report_is_gated_on_the_report_service_path", () => {
    expect(podPathOf(report)).toBe(BIP_SERVICE_PATH);
    expect(inlineRefusal(report, { ...policy, allowPrefixes: ["/fscmRestApi/resources/"] }))
      .toBe("datasource not allowed: report /Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo runs through /xmlpserver/services/ExternalReportWSSService, which is not under datasources.allowPrefixes");
    expect(inlineRefusal(report, { ...policy, allowPrefixes: ["/xmlpserver/"] })).toBeNull();
    expect(inlineRefusal(report, { ...policy, allowInline: false, allowPrefixes: ["/xmlpserver/"] })).toBe("datasource not allowed: datasources.allowInline is off");
    expect(sourceRefusal(report)).toBeNull();
  });

  test("check_source_rules", () => {
    const problems: Problem[] = [];
    checkSource({ dataSource: report, valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL" }, "f", problems);
    expect(problems).toEqual([]);
    checkSource({ dataSource: report, valueField: "ID", labelField: "SITE_LABEL", searchField: "SITE_CODE" }, "f", problems);
    checkSource({ dataSource: { ...report, searchParam: undefined } as DataSourceDef, valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL", searchTemplate: {} }, "g", problems);
    checkSource({ dataSource: ds, valueField: "anything", labelField: "goes", searchField: "x" }, "h", problems);
    expect(problems.map((p) => `${p.path}: ${p.message}`)).toEqual([
      'f.valueField: "ID" is not one of the report\'s columns',
      "f.searchField: does not apply with dataSource.searchParam (the report searches)",
      "g.searchTemplate: needs dataSource.searchParam (without it the typed text filters the report's rows locally, no request)",
    ]);
  });

  test("a_config_overlay_may_carry_a_report_and_its_rules_are_config_errors", () => {
    const min = { mode: "chat", agent: { workflowCode: "WF_1" }, auth: { kind: "fusionShell" }, protocol: { checkVersion: "2607100" } };
    const r = validateConfig({ ...min, widgets: { w: { fields: { f: { dataSource: report, valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL" } } } } });
    expect(r.ok && r.config.widgets).toEqual({ w: { fields: { f: { dataSource: report, valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL" } } } });
    const bad = validateConfig({ ...min, widgets: { w: { fields: { f: { dataSource: report, valueField: "VENDOR_SITE_ID", labelField: "NAME" } } } } });
    expect(bad.ok ? [] : bad.problems.map((p) => `${p.path}: ${p.message}`)).toContain('widgets.w.fields.f.labelField: "NAME" is not one of the report\'s columns');
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

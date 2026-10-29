// A JSON value as a tree (JET's classic oj-tree-view: the Core Pack has no tree): Oracle's JSON-in-string values are shown
// decoded and marked, a value Oracle cut is marked, a string is shown whole and wrapped with its line breaks, the matches
// of the inspector's search are expanded and highlighted.
// Selecting a row shows its path with Copy value / Copy path.
import "ojs/ojtreeview";
import "oj-c/button";
import ArrayTreeDataProvider = require("ojs/ojarraytreedataprovider");
import { KeySetImpl } from "ojs/ojkeyset";
import { useMemo, useState } from "preact/hooks";
import { copyText, decode, search, tree, valueAt } from "../run/decode";
import type { TreeItem } from "../run/decode";
import { copy } from "./clipboard";

/** Every ancestor path of the given paths (so a hit deep in the tree is visible). */
function ancestors(paths: string[]): string[] {
  const out = new Set<string>(["$"]);
  for (const p of paths) {
    const re = /\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\]/g;
    let at = "$";
    const rest = p.slice(1);
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
      out.add(at);
      at += m[0];
    }
  }
  return [...out];
}

/** The row renderer (oj-tree-view draws rows through a renderer function): key, value by kind, and its marks. */
function renderRow(query: string) {
  return (ctx: { data?: TreeItem }): { insert: Element } => {
    const t = ctx.data as TreeItem;
    const row = document.createElement("span");
    row.className = "dbg-json__row";
    row.setAttribute("data-json-path", t.path);
    const key = document.createElement("span");
    key.className = "dbg-json__key";
    key.textContent = t.label;
    row.appendChild(key);
    const value = document.createElement("span");
    value.className = `dbg-json__value dbg-json__value--${t.kind}`;
    // A string whole, between quotes, its line breaks kept (the row wraps it: index.html .dbg-json__value--string).
    value.textContent = t.children !== undefined ? ` ${t.text}` : `: ${t.kind === "string" || t.kind === "cut" ? `"${t.text}"` : t.text}`;
    row.appendChild(value);
    const q = query.toLowerCase();
    if (q !== "" && (t.label.toLowerCase().includes(q) || (t.children === undefined && t.text.toLowerCase().includes(q)))) row.classList.add("dbg-json__row--hit");
    if (t.decoded) row.appendChild(mark("decoded from JSON text", "dbg-json__mark"));
    if (t.kind === "cut") row.appendChild(mark("cut by Oracle at 10 000 characters", "dbg-json__mark dbg-json__mark--cut"));
    return { insert: row };
  };
}

function mark(text: string, cls: string): Element {
  const m = document.createElement("span");
  m.className = cls;
  m.textContent = text;
  return m;
}

export function JsonView(props: { value: unknown; label: string; query: string; testId: string; emptyText?: string }) {
  const decoded = useMemo(() => decode(props.value), [props.value]);
  const root = useMemo(() => tree(decoded, props.label), [decoded, props.label]);
  const hits = useMemo(() => search(root, props.query), [root, props.query]);
  const data = useMemo(() => new ArrayTreeDataProvider<string, TreeItem>([root], { keyAttributes: "path", childrenAttribute: "children" }), [root]);
  // Opened: the root, its first level, and the way to every search hit. The user's own expanding is kept until the value
  // or the search changes.
  const initial = useMemo(() => new KeySetImpl<string>([...ancestors(hits), "$", ...(root.children ?? []).filter((c) => c.children !== undefined && (c.children.length <= 30)).map((c) => c.path)]), [root, hits]);
  const [expanded, setExpanded] = useState<{ base: unknown; keys: KeySetImpl<string> } | null>(null);
  const keys = expanded !== null && expanded.base === initial ? expanded.keys : initial;
  const [selected, setSelected] = useState<string | null>(null);
  const renderer = useMemo(() => renderRow(props.query), [props.query]);
  const selectedKeys = useMemo(() => new KeySetImpl<string>(selected !== null ? [selected] : []), [selected]);
  if (props.value === undefined) return <p class="oj-typography-body-sm oj-text-color-secondary" data-testid={props.testId}>{props.emptyText ?? "Nothing"}</p>;
  const sel = selected !== null ? valueAt(decoded, selected) : undefined;
  return (
    <div class="dbg-json" data-testid={props.testId}>
      {selected !== null && (
        <div class="oj-flex oj-sm-align-items-center oj-sm-flex-wrap-nowrap oj-sm-padding-1x-vertical">
          <code class="dbg-json__path oj-typography-body-xs" data-testid="dbg-json-path">{selected}</code>
          <oj-c-button size="sm" chroming="borderless" label="Copy value" onojAction={() => copy(copyText(sel))} />
          <oj-c-button size="sm" chroming="borderless" label="Copy path" onojAction={() => copy(selected)} />
        </div>
      )}
      <oj-tree-view class="dbg-json__tree" aria-label={props.label} data={data} item={{ renderer } as any}
        expanded={keys} onexpandedChanged={(e: { detail: { value: unknown } }) => setExpanded({ base: initial, keys: e.detail.value as KeySetImpl<string> })}
        selectionMode="single" selected={selectedKeys}
        onselectedChanged={(e: { detail: { value: unknown; updatedFrom?: string } }) => {
          if (e.detail.updatedFrom !== "internal") return;
          const v = e.detail.value as KeySetImpl<string>;
          const first = v.values().values().next();
          setSelected(first.done === true ? null : (first.value as string));
        }} />
    </div>
  );
}

import "oj-c/button";
import "oj-c/input-text";
import "oj-c/list-item-layout";
import "oj-c/list-view";
import "oj-c/toggle-button";
import Context = require("ojs/ojcontext");
import { KeySetImpl } from "ojs/ojkeyset";
import MutableArrayDataProvider = require("ojs/ojmutablearraydataprovider");
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDate } from "../lib/history/formatDate";
import type { ConversationSummary } from "../lib/history/HistoryStore";
import { Banner } from "./Banner";
import type { ChatErrorDetail, ConversationList } from "./useChatController";

/** A delete needs a second click within this window. */
const CONFIRM_MS = 3000;

const why = (e: ChatErrorDetail): string => (e.status ? "HTTP " + e.status : e.message);

const stop = (e: Event): void => e.stopPropagation();

/**
 * A row's own controls (its action buttons, the name editor): their pointer, click and key events stay here, so the list
 * view neither selects nor opens the row for them and its keyboard navigation does not take keys typed into the editor.
 */
function RowControls(props: { slot?: string; children: ComponentChildren }) {
  return (
    <div {...(props.slot !== undefined && { slot: props.slot })} class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-center"
      onPointerDown={stop} onMouseDown={stop} onClick={stop} onKeyDown={stop} onKeyUp={stop}>
      {props.children}
    </div>
  );
}

/** Inline name editor: Enter saves, Escape (or leaving the field) cancels; an empty or unchanged name is a cancel. */
function RenameInput(props: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initial);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // The field's <input> exists once the element has rendered.
    void Context.getContext(el).getBusyContext().whenReady().then(() => {
      const input = el.querySelector("input");
      input?.focus();
      input?.select();
    });
  }, []);
  return (
    <oj-c-input-text
      ref={ref}
      class="oj-sm-flex-1"
      data-testid="gai-conv-rename-input"
      labelHint="Conversation name"
      labelEdge="none"
      userAssistanceDensity="compact"
      value={value}
      onrawValueChanged={(e) => setValue(e.detail.value ?? "")}
      // Capture phase: the field handles Escape itself and would otherwise keep it from reaching us.
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          const name = value.trim();
          if (name === "" || name === props.initial) props.onCancel();
          else props.onSave(name);
        } else if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
      onfocusout={(e) => { if (!(e.relatedTarget instanceof Node && ref.current?.contains(e.relatedTarget))) props.onCancel(); }}
    />
  );
}

/**
 * One list-view row: the conversation and the view state its template renders from. The list view re-renders a row when
 * its object changes (a data-provider update), so this state lives in the data, not in the template's closure.
 */
interface Row { id: string; item: ConversationSummary; active: boolean; editing: boolean; armed: boolean }

/** What a row's controls do; read at event time, so a row never acts on a stale render's state. */
interface RowActions {
  startRename(id: string): void;
  rename(id: string, name: string): void;
  cancelRename(): void;
  remove(id: string): void;
}

function ConversationRow(props: { row: Row; actions: { current: RowActions } }) {
  const { item, active, editing, armed } = props.row;
  const act = props.actions;
  const name = item.name === "" ? "Untitled" : item.name;
  return (
    <oj-c-list-item-layout data-testid="gai-conv-row" data-conv-id={item.id} aria-current={active ? "true" : undefined}>
      {/* One fixed default-slot child: the element moves its slot nodes into its own layout, so a swapped slot node
          would not be removed; the name/editor swap happens inside this one. */}
      <div class="gai-shrink">
        {editing ? (
          <RowControls>
            <RenameInput initial={item.name} onSave={(n) => act.current.rename(item.id, n)} onCancel={() => act.current.cancelRename()} />
          </RowControls>
        ) : (
          <div class={"gai-conv-name gai-truncate" + (active ? " oj-typography-semi-bold" : "")} title={name}>{name}</div>
        )}
      </div>
      <span slot="secondary" class="gai-conv-date oj-typography-body-xs oj-text-color-secondary oj-helper-white-space-nowrap">{formatDate(item.updatedAt)}</span>
      <RowControls slot="action">
        <oj-c-button data-testid="gai-conv-rename" chroming="borderless" display="icons" size="sm" label="Rename"
          onojAction={() => act.current.startRename(item.id)}>
          <span slot="startIcon" class="oj-ux-ico-edit" />
        </oj-c-button>
        {/* Armed (first click): the red Confirm; a second click within CONFIRM_MS deletes. */}
        <oj-c-button data-testid="gai-conv-delete" size="sm" chroming={armed ? "danger" : "borderless"}
          display={armed ? "all" : "icons"} label={armed ? "Confirm" : "Delete"} aria-label={armed ? "Confirm delete" : "Delete"}
          onojAction={() => act.current.remove(item.id)}>
          <span slot="startIcon" class="oj-ux-ico-trash" />
        </oj-c-button>
      </RowControls>
    </oj-c-list-item-layout>
  );
}

export function Sidebar(props: {
  list: ConversationList;
  /** The open conversation: its row is marked current. */
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { list, activeId } = props;
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const disarm = (): void => {
    window.clearTimeout(armTimer.current);
    setArmed(null);
  };

  const actions = useRef<RowActions>(null as unknown as RowActions);
  actions.current = {
    startRename: (id) => { disarm(); setEditing(id); },
    rename: (id, name) => {
      setEditing(null);
      setActionError(null);
      void list.rename(id, name).then((err) => { if (err) setActionError("Rename failed (" + why(err) + ")"); });
    },
    cancelRename: () => setEditing(null),
    remove: (id) => {
      if (armed !== id) {
        window.clearTimeout(armTimer.current);
        setArmed(id);
        armTimer.current = window.setTimeout(() => setArmed(null), CONFIRM_MS);
        return;
      }
      disarm();
      setActionError(null);
      void list.remove(id).then((err) => { if (err) setActionError("Delete failed (" + why(err) + ")"); });
    },
  };

  // Row objects are reused while their conversation and view state are unchanged, so only changed rows re-render.
  const rowCache = useRef(new Map<string, Row>());
  const rows = useMemo(() => {
    const next = new Map<string, Row>();
    const out = list.items.map((item) => {
      const state = { active: item.id === activeId, editing: item.id === editing, armed: item.id === armed };
      const prev = rowCache.current.get(item.id);
      const same = prev !== undefined && prev.item === item && prev.active === state.active && prev.editing === state.editing
        && prev.armed === state.armed;
      const row = same ? prev : { id: item.id, item, ...state };
      next.set(item.id, row);
      return row;
    });
    rowCache.current = next;
    return out;
  }, [list.items, activeId, editing, armed]);
  const data = useMemo(() => new MutableArrayDataProvider<string, Row>(rows, { keyAttributes: "id" }), []);
  useEffect(() => { data.data = rows; }, [rows]);
  const renderRow = useCallback((ctx: { data: Row }) => <ConversationRow row={ctx.data} actions={actions} />, []);

  // The selection always shows the open conversation; a click elsewhere reverts until the row's action has opened it.
  const [resync, setResync] = useState(0);
  const selected = useMemo(() => new KeySetImpl<string>([activeId]), [activeId, resync]);

  return (
    <aside class={"gai-sidebar oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-border-end" + (collapsed ? " oj-sm-flex-initial" : "")}
      data-testid="gai-sidebar" aria-label="Conversations">
      <div class={"oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-center oj-sm-padding-2x" + (collapsed ? "" : " oj-border-bottom")}>
        <oj-c-toggle-button data-testid="gai-sidebar-toggle" chroming="borderless" display="icons" label="Conversations"
          value={!collapsed} onvalueChanged={(e) => setCollapsed(e.detail.value !== true)}>
          <span slot="startIcon" class={collapsed ? "oj-ux-ico-chevron-double-right" : "oj-ux-ico-chevron-double-left"} />
        </oj-c-toggle-button>
        {!collapsed && (
          <>
            <oj-c-button data-testid="gai-conv-refresh" chroming="borderless" display="icons" label="Refresh"
              disabled={list.loading} onojAction={list.refresh}>
              <span slot="startIcon" class="oj-ux-ico-refresh" />
            </oj-c-button>
            <oj-c-button class="oj-helper-margin-start-auto" data-testid="gai-conv-new" chroming="outlined" label="New" onojAction={props.onNew}>
              <span slot="startIcon" class="oj-ux-ico-plus" />
            </oj-c-button>
          </>
        )}
      </div>
      {!collapsed && (
        <>
          {list.error && (
            <Banner testId="gai-conversations-error" severity="error" class="oj-sm-margin-2x"
              summary={`Conversations unavailable (${why(list.error)})`} />
          )}
          {actionError !== null && <Banner testId="gai-conv-action-error" severity="error" class="oj-sm-margin-2x" summary={actionError} />}
          {list.items.length === 0 && !list.error && (
            <div class="oj-typography-body-sm oj-text-color-secondary oj-sm-padding-2x-vertical oj-sm-padding-3x-horizontal">
              {list.loading ? "Loading…" : "No conversations yet"}
            </div>
          )}
          {list.items.length > 0 && (
            <oj-c-list-view class="gai-conv-list oj-sm-flex-1" aria-label="Conversations" data={data} selectionMode="single" selected={selected}
              onselectedChanged={(e) => { if (!(e.detail.value?.has(activeId) ?? false)) setResync((n) => n + 1); }}
              onojItemAction={(e) => {
                const id = (e.detail.context.data as Row).id;
                // The open conversation is not reopened: that would replace this session's turns with the pod's history.
                if (editing !== id && id !== activeId) props.onOpen(id);
              }}>
              <template slot="itemTemplate" render={renderRow} />
            </oj-c-list-view>
          )}
          {list.hasMore && (
            <div class="oj-sm-padding-2x">
              <oj-c-button data-testid="gai-conv-more" chroming="outlined" label="Load more" disabled={list.loading} onojAction={list.loadMore} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

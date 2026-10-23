import "oj-c/button";
import "oj-c/input-text";
import "oj-c/list-item-layout";
import "oj-c/list-view";
import "oj-c/menu-button";
import "oj-c/message-toast";
import "oj-c/progress-circle";
import "oj-c/truncating-text";
import Context = require("ojs/ojcontext");
import { KeySetImpl } from "ojs/ojkeyset";
import MutableArrayDataProvider = require("ojs/ojmutablearraydataprovider");
import type { ComponentChildren, VNode } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDate } from "../lib/history/formatDate";
import type { ConversationSummary } from "../lib/history/HistoryStore";
import { Banner } from "./Banner";
import type { ChatErrorDetail, ConversationList } from "./useChatController";

/** Choosing Delete arms the row's Confirm button for this long; a click on it within the window deletes. */
const CONFIRM_MS = 3000;

/** A row's actions menu (oj-c-menu-button items; the chosen key arrives in ojMenuAction). */
const ROW_MENU = [
  { key: "rename", label: "Rename", startIcon: { class: "oj-ux-ico-edit" } },
  { key: "delete", label: "Delete", variant: "destructive" as const, startIcon: { class: "oj-ux-ico-trash" } },
];

/** A failed rename/delete, shown as a Redwood toast (transient: it is not the state of anything on screen). */
type ActionError = { id: number; severity: "error"; summary: string };

const why = (e: ChatErrorDetail): string => (e.status ? "HTTP " + e.status : e.message);

const stop = (e: Event): void => e.stopPropagation();

/**
 * A row's own controls (its actions menu, the confirm button, the name editor): their pointer, click and key events stay
 * here, so the list view neither selects nor opens the row for them and its keyboard navigation does not take keys typed
 * into the editor.
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

/** One list-view row: the conversation and its view state (the item template reads the state from its closure). */
interface Row { item: ConversationSummary; active: boolean; editing: boolean; armed: boolean }

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
          <oj-c-truncating-text class="gai-conv-name" title={name} value={name} truncation="ellipsis" weight={active ? "semiBold" : "normal"} />
        )}
      </div>
      {/* On the name's line, at its end (one line per row). */}
      <span slot="metadata" class="gai-conv-date oj-typography-body-xs oj-text-color-secondary oj-helper-white-space-nowrap">{formatDate(item.updatedAt)}</span>
      <RowControls slot="action">
        {/* Delete in the menu arms the row: the red Confirm replaces the menu, and a click on it within CONFIRM_MS deletes. */}
        {armed ? (
          <oj-c-button data-testid="gai-conv-delete" size="sm" chroming="danger" label="Confirm" aria-label="Confirm delete"
            onojAction={() => act.current.remove(item.id)}>
            <span slot="startIcon" class="oj-ux-ico-trash" />
          </oj-c-button>
        ) : (
          <oj-c-menu-button data-testid="gai-conv-actions" size="sm" chroming="borderless" display="icons" label="Conversation actions"
            items={ROW_MENU} onojMenuAction={(e) => (e.detail.key === "rename" ? act.current.startRename(item.id) : act.current.remove(item.id))} />
        )}
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
  /** The drawer's toggle, shown first in the header while the drawer is open. */
  toggle?: VNode;
}) {
  const { list, activeId } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  // At most one action error at a time: a new action clears it, its failure shows a new one.
  const errors = useMemo(() => new MutableArrayDataProvider<number, ActionError>([], { keyAttributes: "id" }), []);
  const errorSeq = useRef(0);
  const setActionError = (summary: string | null): void => {
    if (summary !== null) errors.data = [{ id: ++errorSeq.current, severity: "error", summary }];
    else if (errors.data.length > 0) errors.data = [];
  };
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

  // The data holds the conversations; a new template (view state changed) re-renders the rows.
  const data = useMemo(() => new MutableArrayDataProvider<string, ConversationSummary>(list.items, { keyAttributes: "id" }), []);
  useEffect(() => { data.data = list.items; }, [list.items]);
  const renderRow = useCallback((ctx: { data: ConversationSummary }) => {
    const id = ctx.data.id;
    return <ConversationRow row={{ item: ctx.data, active: id === activeId, editing: id === editing, armed: id === armed }} actions={actions} />;
  }, [activeId, editing, armed]);

  const renderNoData = useCallback(() => (
    <div class="oj-flex oj-sm-align-items-center oj-typography-body-sm oj-text-color-secondary oj-sm-padding-2x-vertical oj-sm-padding-3x-horizontal">
      {list.loading
        ? <><oj-c-progress-circle class="oj-sm-margin-2x-end" size="sm" value={-1} aria-label="Loading" />{"Loading…"}</>
        : "No conversations yet"}
    </div>
  ), [list.loading]);

  // The selection always shows the open conversation; a click elsewhere reverts until the row's action has opened it.
  const [resync, setResync] = useState(0);
  const selected = useMemo(() => new KeySetImpl<string>([activeId]), [activeId, resync]);

  return (
    // The conversations drawer's content (oj-c-drawer-layout start slot, see ChatShell).
    <div slot="start" class="gai-sidebar oj-flex oj-sm-flex-direction-column oj-sm-flex-wrap-nowrap oj-sm-height-full"
      data-testid="gai-sidebar" role="complementary" aria-label="Conversations">
      {/* One compact row of small buttons: the drawer toggle, Refresh, and New at the end. */}
      <div class="oj-flex oj-sm-flex-wrap-nowrap oj-sm-align-items-center oj-sm-padding-2x oj-border-bottom">
        {props.toggle}
        <oj-c-button data-testid="gai-conv-refresh" size="sm" chroming="borderless" display="icons" label="Refresh"
          disabled={list.loading} onojAction={list.refresh}>
          <span slot="startIcon" class="oj-ux-ico-refresh" />
        </oj-c-button>
        <oj-c-button class="oj-helper-margin-start-auto" data-testid="gai-conv-new" size="sm" chroming="outlined" label="New" onojAction={props.onNew}>
          <span slot="startIcon" class="oj-ux-ico-plus" />
        </oj-c-button>
      </div>
      {list.error && (
        <Banner testId="gai-conversations-error" severity="error" class="oj-sm-margin-2x"
          summary={`Conversations unavailable (${why(list.error)})`} />
      )}
      {!(list.error && list.items.length === 0) && (
        <oj-c-list-view class="gai-conv-list oj-sm-flex-1" aria-label="Conversations" data={data} selectionMode="single" selected={selected}
          onselectedChanged={(e) => { if (!(e.detail.value?.has(activeId) ?? false)) setResync((n) => n + 1); }}
          onojItemAction={(e) => {
            const id = (e.detail.context.data as ConversationSummary).id;
            // The open conversation is not reopened: that would replace this session's turns with the pod's history.
            if (editing !== id && id !== activeId) props.onOpen(id);
          }}>
          <template slot="itemTemplate" render={renderRow} />
          <template slot="noData" render={renderNoData} />
        </oj-c-list-view>
      )}
      {list.hasMore && (
        <div class="oj-sm-padding-2x">
          <oj-c-button data-testid="gai-conv-more" chroming="outlined" label="Load more" disabled={list.loading} onojAction={list.loadMore} />
        </div>
      )}
      <oj-c-message-toast data-testid="gai-conv-action-error" data={errors}
        onojClose={(e) => { errors.data = errors.data.filter((m) => m.id !== e.detail.key); }} />
    </div>
  );
}

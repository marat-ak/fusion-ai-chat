import { useEffect, useRef, useState } from "preact/hooks";
import { formatDate } from "../lib/history/formatDate";
import type { ConversationSummary } from "../lib/history/HistoryStore";
import type { ChatErrorDetail, ConversationList } from "./useChatController";

/** A delete needs a second click within this window. */
const CONFIRM_MS = 3000;

const why = (e: ChatErrorDetail): string => (e.status ? "HTTP " + e.status : e.message);

/** Inline name editor: Enter saves, Escape (or leaving the field) cancels; an empty or unchanged name is a cancel. */
function RenameInput(props: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      class="gai-conv-rename-input"
      data-testid="gai-conv-rename-input"
      aria-label="Conversation name"
      value={value}
      onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
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
      onBlur={props.onCancel}
    />
  );
}

export function Sidebar(props: {
  list: ConversationList;
  /** The open conversation: its row is marked current. */
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { list } = props;
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

  const onDelete = (id: string): void => {
    if (armed !== id) {
      window.clearTimeout(armTimer.current);
      setArmed(id);
      armTimer.current = window.setTimeout(() => setArmed(null), CONFIRM_MS);
      return;
    }
    disarm();
    setActionError(null);
    void list.remove(id).then((err) => { if (err) setActionError("Delete failed (" + why(err) + ")"); });
  };

  const onRename = (id: string, name: string): void => {
    setEditing(null);
    setActionError(null);
    void list.rename(id, name).then((err) => { if (err) setActionError("Rename failed (" + why(err) + ")"); });
  };

  const row = (it: ConversationSummary) => {
    const active = it.id === props.activeId;
    const name = it.name === "" ? "Untitled" : it.name;
    const isArmed = armed === it.id;
    return (
      <li
        key={it.id}
        class={"gai-conv-row" + (active ? " gai-conv-row--active" : "")}
        data-testid="gai-conv-row"
        data-conv-id={it.id}
        aria-current={active ? "true" : undefined}
        // The open conversation is not reopened: that would replace this session's turns with the pod's history.
        onClick={() => { if (editing !== it.id && !active) props.onOpen(it.id); }}
      >
        {editing === it.id ? (
          <RenameInput initial={it.name} onSave={(n) => onRename(it.id, n)} onCancel={() => setEditing(null)} />
        ) : (
          // No handler of its own: the click reaches the row, so mouse and keyboard open the conversation the same way.
          <button type="button" class="gai-conv-open" title={name}>
            <span class="gai-conv-name">{name}</span>
          </button>
        )}
        <div class="gai-conv-meta">
          <span class="gai-conv-date">{formatDate(it.updatedAt)}</span>
          <span class="gai-conv-actions">
            <button type="button" class="gai-conv-action" data-testid="gai-conv-rename"
              onClick={(e) => { e.stopPropagation(); disarm(); setEditing(it.id); }}>
              Rename
            </button>
            <button type="button" class={"gai-conv-action" + (isArmed ? " gai-conv-action--armed" : "")} data-testid="gai-conv-delete"
              aria-label={isArmed ? "Confirm delete" : "Delete"}
              onClick={(e) => { e.stopPropagation(); onDelete(it.id); }}>
              {isArmed ? "Confirm" : "Delete"}
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <aside class={"gai-sidebar" + (collapsed ? " gai-sidebar--collapsed" : "")} data-testid="gai-sidebar" aria-label="Conversations">
      <div class="gai-sidebar-bar">
        <button type="button" class="gai-sidebar-toggle" data-testid="gai-sidebar-toggle"
          aria-expanded={!collapsed} aria-label={collapsed ? "Show conversations" : "Hide conversations"}
          title={collapsed ? "Show conversations" : "Hide conversations"}
          onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "»" : "«"}
        </button>
        {!collapsed && (
          <>
            <button type="button" class="gai-button gai-conv-refresh" data-testid="gai-conv-refresh"
              disabled={list.loading} onClick={list.refresh}>
              Refresh
            </button>
            <button type="button" class="gai-button gai-conv-new" data-testid="gai-conv-new" onClick={props.onNew}>
              New
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <>
          {list.error && (
            <div class="gai-conv-notice gai-conv-notice--error" data-testid="gai-conversations-error" role="status">
              Conversations unavailable ({why(list.error)})
            </div>
          )}
          {actionError !== null && (
            <div class="gai-conv-notice gai-conv-notice--error" data-testid="gai-conv-action-error" role="alert">{actionError}</div>
          )}
          {list.items.length === 0 && !list.error && (
            <div class="gai-conv-notice">{list.loading ? "Loading…" : "No conversations yet"}</div>
          )}
          <ul class="gai-conv-list">{list.items.map(row)}</ul>
          {list.hasMore && (
            <button type="button" class="gai-button gai-conv-more" data-testid="gai-conv-more" disabled={list.loading} onClick={list.loadMore}>
              Load more
            </button>
          )}
        </>
      )}
    </aside>
  );
}

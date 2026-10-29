import "oj-c/progress-circle";
import { useMemo } from "preact/hooks";
import type { WidgetOverlay } from "../lib/config/types";
import { applyOverlay, parseBlock } from "../lib/widgets/block";
import type { ReplyPart } from "../lib/widgets/block";
import type { EndpointFetch } from "../lib/endpoints/EndpointFetch";
import type { DataSourcePolicy } from "../lib/widgets/datasource";
import type { Submit } from "../lib/widgets/submit";
import { Banner } from "./Banner";
import type { MarkdownRenderer } from "./Bubble";
import { WidgetHost } from "./WidgetHost";

/** What the gnimsys-ui blocks of a reply need from the chat (ChatShell builds it once per render). */
export interface WidgetContext {
  policy: DataSourcePolicy;
  overlays: Record<string, WidgetOverlay>;
  /** The page's endpoints: datasource selects page and search through them. */
  endpoints: EndpointFetch;
  /** The chat accepts a new message now. */
  canSend: boolean;
  /** No reply, upload or history load is pending: a block's controls may mount (see WidgetHost). */
  settled: boolean;
  onSubmit: (text: string) => void;
}

/** A parsed block, keyed by its position in the reply (stable across re-renders of the same reply). */
function BlockView(props: { raw: string; ctx: WidgetContext; submitted: Submit[]; mount: boolean }) {
  const { raw, ctx } = props;
  const parsed = useMemo(() => parseBlock(raw), [raw]);
  if (!parsed.ok) {
    return (
      <Banner testId="gai-widget-error" severity="error" summary={`Widget block not shown: ${parsed.reason}`}>
        <pre class="gai-widget-raw oj-typography-body-xs" data-testid="gai-widget-raw">{raw}</pre>
      </Banner>
    );
  }
  const block = applyOverlay(parsed.block, ctx.overlays[parsed.block.id]);
  if (!props.mount) {
    return (
      <div class="oj-flex oj-sm-align-items-center" data-testid="gai-widget-pending" role="status">
        <oj-c-progress-circle size="sm" value={-1} aria-label="Loading form" />
      </div>
    );
  }
  const submitted = props.submitted.find((s) => s.id === block.id);
  return (
    <WidgetHost block={block} deps={{ policy: ctx.policy, endpoints: ctx.endpoints, canSend: ctx.canSend, onSubmit: ctx.onSubmit }}
      {...(submitted !== undefined && { submitted })} />
  );
}

/**
 * The content of one assistant bubble (spec §5 item 5): a reply is split at its ```gnimsys-ui blocks BEFORE the markdown
 * renders (block.ts replyParts; Bubble.tsx shows each part as its own bubble). A text part renders as markdown (plain
 * text until the renderer has loaded); a block part is a WidgetHost, its controls mounted once `mount` (the reply has
 * settled once); without a widget context (no chat) a block is shown as its raw text.
 */
export function ReplyPartContent(props: { part: ReplyPart; renderer: MarkdownRenderer | null; ctx?: WidgetContext; submitted: Submit[]; mount: boolean }) {
  const { part, renderer, ctx } = props;
  if (part.kind === "block") {
    return ctx !== undefined
      ? <BlockView raw={part.raw} ctx={ctx} submitted={props.submitted} mount={props.mount} />
      : <pre class="gai-widget-raw">{part.raw}</pre>;
  }
  return renderer
    ? <div class="gai-md" dangerouslySetInnerHTML={{ __html: renderer.render(part.text) }} />
    : <div class="oj-helper-white-space-pre-wrap">{part.text}</div>;
}

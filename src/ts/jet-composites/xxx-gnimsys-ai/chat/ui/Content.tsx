import "oj-c/progress-circle";
import { useMemo, useRef } from "preact/hooks";
import type { WidgetOverlay } from "../lib/config/types";
import { applyOverlay, parseBlock, splitBlocks } from "../lib/widgets/block";
import type { Segment } from "../lib/widgets/block";
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
      <Banner testId="gai-widget-error" severity="error" class="oj-sm-margin-2x-top" summary={`Widget block not shown: ${parsed.reason}`}>
        <pre class="gai-widget-raw oj-typography-body-xs" data-testid="gai-widget-raw">{raw}</pre>
      </Banner>
    );
  }
  const block = applyOverlay(parsed.block, ctx.overlays[parsed.block.id]);
  if (!props.mount) {
    return (
      <div class="oj-flex oj-sm-align-items-center oj-sm-margin-2x-top" data-testid="gai-widget-pending" role="status">
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
 * The content of an assistant bubble (spec §5 item 5): the reply's ```gnimsys-ui blocks are taken out BEFORE the
 * markdown renders, the text around them renders as markdown (plain text until the renderer has loaded), and a WidgetHost
 * takes each block's place. A block's controls mount once the turn has settled and then stay mounted (`ctx.settled` may
 * flip again while a later turn runs); without a widget context (no chat) blocks are shown as their raw text.
 */
export function AssistantContent(props: { text: string; renderer: MarkdownRenderer | null; ctx?: WidgetContext; submitted: Submit[] }) {
  const { text, renderer, ctx } = props;
  const segments = useMemo<Segment[]>(() => splitBlocks(text), [text]);
  const mounted = useRef(false);
  const mount = mounted.current || (ctx?.settled ?? false);
  mounted.current = mount;
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "block") {
          return ctx !== undefined
            ? <BlockView key={`b${s.index}`} raw={s.raw} ctx={ctx} submitted={props.submitted} mount={mount} />
            : <pre key={`b${s.index}`} class="gai-widget-raw">{s.raw}</pre>;
        }
        return renderer
          ? <div key={`t${i}`} class="gai-md" dangerouslySetInnerHTML={{ __html: renderer.render(s.text) }} />
          : <div key={`t${i}`} class="oj-helper-white-space-pre-wrap">{s.text}</div>;
      })}
    </>
  );
}

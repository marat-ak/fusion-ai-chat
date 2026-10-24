import "oj-c/collapsible";
import { useState } from "preact/hooks";

/**
 * Developer panel (`ui.debug.rawFrames`): every SSE `data:` payload of one reply, verbatim and in arrival order, under the
 * reply. Collapsed by default; it grows live while the reply streams.
 */
export function RawFramesPanel(props: { frames: string[] }) {
  const [open, setOpen] = useState(false);
  const { frames } = props;
  if (frames.length === 0) return null;
  return (
    <oj-c-collapsible class="oj-sm-align-self-flex-start oj-sm-margin-2x-bottom" expanded={open}
      onexpandedChanged={(e) => setOpen(e.detail.value === true)}>
      <span slot="header" class="oj-typography-body-xs oj-text-color-secondary" data-testid="gai-raw-toggle">
        {`Raw frames (${frames.length})`}
      </span>
      {/* Rows are rendered only while expanded. The fixed wrapper is the element's one default-slot node (it moves its
          slot nodes into its own layout, so a slot node that comes and goes would not be removed). */}
      <div>
        {open && (
          <div class="oj-panel oj-typography-body-xs oj-text-color-secondary oj-helper-white-space-pre-wrap oj-helper-overflow-wrap-anywhere"
            data-testid="gai-raw" role="list">
            {frames.map((f, i) => (
              <div key={i} role="listitem" data-testid="gai-raw-frame"><code>{`#${i + 1} ${f}`}</code></div>
            ))}
          </div>
        )}
      </div>
    </oj-c-collapsible>
  );
}

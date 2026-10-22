interface MarkdownIt {
  render(md: string): string;
}
type SanitizeHook = (node: Element) => void;
interface Purify {
  sanitize(html: string, cfg: Record<string, unknown>): string;
  addHook(entryPoint: "afterSanitizeAttributes", hook: SanitizeHook): void;
  removeHook(entryPoint: "afterSanitizeAttributes", hook?: SanitizeHook): unknown;
}

// Form controls are dropped too: a reply must not pose as a sign-in or any other form of the page.
const FORBID_TAGS = ["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base", "input", "button", "select", "textarea"];
// No inline styles: a reply must not position itself over the page (fixed overlays) or restyle it.
const FORBID_ATTR = ["style"];
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** Images load only from the page's origin or inline (`data:`, `blob:`): a remote image would report the reader to its host. */
function localImage(src: string, origin: string): boolean {
  if (/^(?:data|blob):/i.test(src.trim())) return true;
  try {
    return new URL(src, origin).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Markdown (raw HTML allowed) -> sanitized HTML. Every link opens in a new tab without an opener; a remote image is
 * replaced by the text `[image: <src>]`. `origin` is the page origin that images may load from.
 */
export function createMarkdownRenderer(deps: { markdownit: unknown; purify: unknown; origin: string }): { render(md: string): string } {
  if (typeof deps.markdownit !== "function") throw new Error("markdownit dependency is not a function");
  const purify = deps.purify as Purify;
  if (!purify || typeof purify.sanitize !== "function" || typeof purify.addHook !== "function" || typeof purify.removeHook !== "function") {
    throw new Error("purify dependency has no sanitize()/addHook()/removeHook()");
  }
  const origin = new URL(deps.origin).origin; // throws on a malformed origin

  const md = (deps.markdownit as (o: Record<string, unknown>) => MarkdownIt)({ html: true, linkify: true, breaks: true });

  // Runs on every element after its attributes are sanitized, so it covers markdown links and raw-HTML anchors alike.
  const hook: SanitizeHook = (node) => {
    const tag = node.nodeName.toLowerCase();
    if (tag === "a") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else if (tag === "img") {
      node.removeAttribute("srcset"); // candidates could load from anywhere
      const src = node.getAttribute("src");
      if (src !== null && !localImage(src, origin)) {
        node.parentNode?.replaceChild(node.ownerDocument.createTextNode(`[image: ${src}]`), node);
      }
    }
  };

  return {
    render(src: string): string {
      // Registered only around this call: the vendored DOMPurify instance is shared by every chat on the page.
      purify.addHook("afterSanitizeAttributes", hook);
      try {
        return purify.sanitize(md.render(src), { FORBID_TAGS, FORBID_ATTR, ALLOWED_URI_REGEXP });
      } finally {
        purify.removeHook("afterSanitizeAttributes", hook);
      }
    },
  };
}

interface MarkdownIt {
  renderer: { rules: Record<string, any> };
  render(md: string): string;
}
interface Purify { sanitize(html: string, cfg: Record<string, unknown>): string }

const FORBID_TAGS = ["script", "style", "iframe", "object", "embed", "form", "link", "meta", "base"];
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

export function createMarkdownRenderer(deps: { markdownit: unknown; purify: unknown }): { render(md: string): string } {
  if (typeof deps.markdownit !== "function") throw new Error("markdownit dependency is not a function");
  const purify = deps.purify as Purify;
  if (!purify || typeof purify.sanitize !== "function") throw new Error("purify dependency has no sanitize()");

  const md = (deps.markdownit as (o: Record<string, unknown>) => MarkdownIt)({ html: true, linkify: true, breaks: true });
  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens: any[], idx: number, options: unknown, env: unknown, self: any) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };

  return {
    render(src: string): string {
      return purify.sanitize(md.render(src), {
        FORBID_TAGS,
        ALLOWED_URI_REGEXP,
        ADD_ATTR: ["target"],
      });
    },
  };
}

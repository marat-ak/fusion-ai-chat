/** @jest-environment jsdom */
import { createMarkdownRenderer } from "../render/markdown";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const markdownit = require("markdown-it");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const purifyMod = require("dompurify");
const purify = typeof purifyMod.sanitize === "function" ? purifyMod : purifyMod(window);

const ORIGIN = "https://pod.example.com";
const { render } = createMarkdownRenderer({ markdownit, purify, origin: ORIGIN });

describe("markdown renderer", () => {
  test("renders_table_and_list", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n- y\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>x</li>");
  });

  test("links_open_in_new_tab_with_noopener", () => {
    const html = render("[o](https://example.com) and https://auto.example.org");
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  test("script_and_onerror_are_stripped", () => {
    const html = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n<iframe src="https://e.com"></iframe>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<iframe");
  });

  test("javascript_url_is_dropped", () => {
    const html = render("[x](javascript:alert(1))\n\n<a href=\"javascript:alert(2)\">y</a>");
    expect(html).not.toMatch(/href=["']?javascript:/i);
  });

  test("style_attribute_is_stripped", () => {
    // A reply must not paint over the page (a fake sign-in overlay).
    const html = render('<div style="position:fixed;inset:0;z-index:99999;background:white">Please sign in again</div>');
    expect(html).toContain("<div>Please sign in again</div>");
    expect(html).not.toContain("style");
    expect(html).not.toContain("position");
  });

  test("remote_image_is_neutralized", () => {
    const html = render([
      "![t](https://evil.example.com/pixel.png?u=1)",
      '<img src="//evil.example.com/x.png">',
      '<img src="/ok.png" srcset="https://evil.example.com/2x.png 2x">',
      "![same](https://pod.example.com/a.png) ![d](data:image/png;base64,iVBORw0KGgo=)",
    ].join("\n\n"));
    expect(html).not.toMatch(/<img[^>]*evil/);
    expect(html).toContain("[image: https://evil.example.com/pixel.png?u=1]");
    expect(html).toContain("[image: //evil.example.com/x.png]");
    expect(html).toMatch(/<img[^>]*src="\/ok\.png"/);
    expect(html).toMatch(/<img[^>]*src="https:\/\/pod\.example\.com\/a\.png"/);
    expect(html).toMatch(/<img[^>]*src="data:image\/png;base64,/);
    expect(html).not.toContain("srcset");
  });

  test("raw_html_anchor_gets_blank_target", () => {
    const html = render('<a href="https://example.com" target="_self" rel="opener">raw</a>');
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('target="_blank"');
    expect(links[0]).toContain('rel="noopener noreferrer"');
    expect(links[0]).not.toContain("_self");
  });

  test("hook_is_not_left_on_the_shared_purify", () => {
    render("[o](https://example.com)");
    expect(purify.sanitize('<a href="https://example.com">x</a>')).not.toContain("target");
  });

  test("form_controls_are_stripped", () => {
    const html = render([
      '<input type="password" placeholder="Password">',
      "<button>Sign in</button>",
      "<select><option>a</option></select>",
      "<textarea>t</textarea>",
    ].join("\n\n"));
    for (const tag of ["<input", "<button", "<select", "<textarea"]) expect(html).not.toContain(tag);
  });

  test("fenced_code_block_renders_pre_code", () => {
    const html = render("```sql\nselect 1\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("select 1");
  });
});

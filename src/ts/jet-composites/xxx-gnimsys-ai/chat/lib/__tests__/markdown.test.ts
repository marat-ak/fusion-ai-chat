/** @jest-environment jsdom */
import { createMarkdownRenderer } from "../render/markdown";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const markdownit = require("markdown-it");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const purifyMod = require("dompurify");
const purify = typeof purifyMod.sanitize === "function" ? purifyMod : purifyMod(window);

const { render } = createMarkdownRenderer({ markdownit, purify });

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

  test("fenced_code_block_renders_pre_code", () => {
    const html = render("```sql\nselect 1\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("select 1");
  });
});

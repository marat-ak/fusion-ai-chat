import { errorText } from "../transport/errorText";

test("errorText_prefers_detail", () => {
  expect(errorText('{"title":"T","detail":"D","message":"M"}')).toBe("D");
  expect(errorText('{"title":"T","message":"M"}')).toBe("T");
  expect(errorText('{"detail":{"x":1},"message":"  M \\n  x "}')).toBe("M x"); // only string fields count
  expect(errorText('{"detail":"a <b> c"}')).toBe("a <b> c"); // JSON text is not HTML
  expect(errorText('{"other":1}')).toBe('{"other":1}');
  expect(errorText("plain failure")).toBe("plain failure");
});

test("errorText_strips_html_and_caps", () => {
  const html = "<html><head><title>Login</title><style>p { color: red }</style><script>var a = 1;</script></head>\n"
    + "<body>\n<h1>Sign   in</h1>\n<p>Session expired</p></body></html>";
  expect(errorText(html)).toBe("Login Sign in Session expired");
  expect(errorText("x".repeat(500))).toBe("x".repeat(300) + "…");
  expect(errorText("abcdef", 3)).toBe("abc…");
  expect(errorText("abc", 3)).toBe("abc");
});

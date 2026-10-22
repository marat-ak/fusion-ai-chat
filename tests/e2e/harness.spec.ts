import { expect, test } from "@playwright/test";

const MOCK_POD = "http://localhost:8787";

test("host_page_renders_component_tag", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("xxx-gnimsys-ai-chat")).toBeVisible();
  expect(await page.evaluate(() => !!customElements.get("xxx-gnimsys-ai-chat"))).toBe(true);
  // The vendored libs resolve through the app's requirejs paths exactly as chat/render/vendor.ts asks for them.
  const vendor = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        (window as any).require(
          ["xxx-gnimsys-ai/libs/markdown-it.min"],
          (mod: unknown) => resolve(typeof mod),
          (err: Error) => resolve("error: " + err.message),
        );
      }),
  );
  expect(vendor).toBe("function");
});

test("mock_relay_requires_xsrf", async ({ page }) => {
  const anonymous = await page.request.get(`${MOCK_POD}/fscmRestApi/tokenrelay?scopesfq=x`);
  expect(anonymous.headers()["content-type"]).toMatch(/^text\/html/);

  const withXsrf = await page.request.get(`${MOCK_POD}/fscmRestApi/tokenrelay?scopesfq=x`, {
    headers: { "x-xsrf-token": "test-xsrf" },
  });
  expect(withXsrf.headers()["content-type"]).toMatch(/^application\/json/);
  expect(typeof (await withXsrf.json()).access_token).toBe("string");
});

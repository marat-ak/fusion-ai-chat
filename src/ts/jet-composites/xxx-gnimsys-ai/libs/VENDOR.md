# Vendored libraries

Vendored UMD builds (not runtime npm dependencies). Loaded at runtime through RequireJS by `chat/render/vendor.ts`.

| File | Package | Version | Source path in package | Licence |
|---|---|---|---|---|
| `markdown-it.min.js` | markdown-it | 14.3.3 | `dist/markdown-it.min.js` | MIT |
| `purify.min.js` | dompurify | 3.4.17 | `dist/purify.min.js` | Apache-2.0 OR MPL-2.0 (dual) |

Vendored: 2026-10-21 (from `npm install markdown-it@14 dompurify@3`).
To update: reinstall the package, copy the same dist file, update this table.

`libs/` is a pack resource component (`component.json`, pack dependency `xxx-gnimsys-ai-libs`) because ojet stages only member components (plus `extension`/`utils`) of a pack, so a plain `libs/` folder never reached `web/` and `require("xxx-gnimsys-ai/libs/…")` failed.
Task 15 must confirm `libs/` (both .min.js files) is inside the `ojet package pack` zip.

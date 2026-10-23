# Vendored libraries

Vendored UMD builds (not runtime npm dependencies), loaded through RequireJS by the pack's modules.

| File | Package | Version | Loaded by | Licence |
|---|---|---|---|---|
| `loglevel.min.js` | loglevel | 1.8.1 | `rest/dashboard-logger.js` | MIT |

Copied 2026-10-23, byte for byte, from the dashboard pack
(`jetConponents/dashboard-component-dev/.../xxx-gnimsys-dashboard/libs/loglevel.min.js`) together with the endpoint layer.

`libs/` is a pack resource component (`component.json`, pack dependency `xxx-gnimsys-data-libs`): ojet stages only member
components of a pack, so a plain folder would never reach `web/` or the package.

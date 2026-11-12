# Architecture

One Node 26 ESM process (Express) serves the JSON API and the built web app (React + Vite, hash routes). The API secret stays in the server; the browser only ever sees `set`.

```
browser  --same-origin-->  server (loopback)  --x-api-key / x-api-secret / x-procyon-session-id-->  Privilege console API
   ^                          |  write gate + audit
   |                          +-- (Mock) -->  in-process mock console (loopback)
```

The same picture is the app's Diagram page (ReactFlow: movable boxes, Simulate, Reset, speed). Its boxes and arrows are not in the page: they are diagram-studio/1 data (`server/diagrams/read.json` and `writes.json`), checked when the server starts and fetched by name from `GET /api/diagrams/:name`.

## Server (`server/src`)

| File | Job |
| --- | --- |
| `app.js` | Routes: connections CRUD, the spec catalog (`/api/spec`), the call proxy (`/api/connections/:id/call`), the connection test, the audit, the mode, the mock helper, static web app. |
| `spec-catalog.json` | The Privilege console swagger reduced to 447 operations (method, path, service, summary, parameters). Generated from a swagger snapshot; never hand-edited. |
| `client.js` | The one console call path: builds the request from the spec's path template (encoded values, tenant from the connection), attaches `x-api-key` / `x-api-secret` / a fresh `x-procyon-session-id`, enforces the write gate, maps the console's 401/403 to `login_required`. |
| `store.js` | Connections file (mode 600, dir 700). The API secret write-only; `publicView` shows `set`. |
| `mock.js` | In-process stand-in for the Privilege console API on loopback: imodel-shaped sample tenant for the modelled collections, honest 404/405 for anything else, the same header auth scheme. Illustrative sample, not a recording; write calls change an in-memory sample. |
| `diagrams.js`, `diagramStudioValidate.js` | Loads `server/diagrams/*.json` (diagram-studio/1) from a fixed name list, validates each with a copy of the studio's validator, and refuses to start on a bad file. Serves them by name. |
| `config.js`, `settings.js` | The mode guards (`realGuards`, `realRefusal`): Real is refused unless the owner opts in (`PRIVILEGE_EXPLORER_MODE=real`) and the bind is loopback or the container opt-in. The shared settings file (`~/Development/.env`, or `STANDALONE_ENV`) read through `util.parseEnv`, one key only. |
| `netguard.js` | Runtime guard installed when the server starts: refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect. A Real call takes a short-lived permit for its console origin (`urls.js` `liveHosts`) while the operation runs. Mock needs none. |
| `security.js`, `redact.js`, `urls.js`, `health.js`, `doctor.js` | Loopback/Host/same-origin guards; scrubbing of every response, error and audit line; the typed-origin rules (SSRF literals); `demo-health/1`; preflight. |
| `audit` (in `app.js`) | Every call — ok, refused, blocked or error — persisted redacted to `.data/audit.jsonl`. |

## Web (`web/src`)

The header holds the Mock / Real toggle (the page always opens in Mock and remembers no mode; `GET /api/info` says whether Real is allowed), the `Mode:` chip, Reset, Present and the theme picker, with the mode banner above them on every page. The toggle decides which saved connections a page works with: the mock console connection in Mock, real consoles in Real. Pages: Explorer (search + filters + operation form + real-time result pane), Connections (wizard, mock demo), Audit, Diagram. Presenter mode toggles with `p`.

The Explorer result pane shows the HTTP status, elapsed ms, the exact path that was called, the session id and the raw body — the console's own refusals included, as-is.

## Mock mode

The in-process mock console starts lazily. `GET /api/mock-url` returns its base, the sample tenant id and the mock's accepted credential pair, and the Connections page builds the loopback connection from it. Every other saved connection is Real: `app.js` refuses it (403 `real_refused`) before any request unless the Real guards pass.

## Packaging and integration

See the table above for the module boundaries; the security model and every pinned rule are in [security.md](security.md). The Docker image is two stages (build the web app, then ship it beside the server), published on loopback only, non-root, read-only, `restart: unless-stopped`.

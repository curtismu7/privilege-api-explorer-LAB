# Security model

What this app protects, and the test that pins each rule. Every claim here names a test that runs in `npm test`.

## The request path

Browser → this app's server (Express, loopback by default) → the Privilege console origin of the connection in use. The browser never holds the API secret and never talks to the console directly.

## What the server holds

- The **API secret** of each saved connection, in `.data/connections.json` (mode 600, in a mode 700 dir). It is write-only: the API answers `apiSecret: "set"`, never the value (`server/test/api.test.js :: connections: create, list, update writes, delete; the secret is never returned`).
- Every response, error and audit line goes through `scrub()`/`scrubJson()`, which replaces the key and secret wherever they might echo back (`server/test/api.test.js :: connection test: the probe proves the credential against the mock, and the audit keeps every call`).

## Network

- **Loopback bind by default.** A non-loopback `PAE_BIND` is an explicit opt-in; inside the container the image sets `PAE_CONTAINER=1` and compose publishes `127.0.0.1:` only (`scripts/compose.test.mjs :: docker-compose.yml publishes only on 127.0.0.1, mapping to the container port 7813`).
- **Host check.** The server answers only to a loopback Host header, or the names in `PAE_ALLOWED_HOSTS` / `LAB_ALLOWED_HOSTS` (the lab-proxy). DNS-rebinding is refused (`server/test/labproxy.test.js :: LAB_ALLOWED_HOSTS: the lab-proxy name is served on any port, other names stay 403`).
- **Same-origin writes.** Every state-changing call must carry an Origin matching Host — or, behind the lab-proxy, the forwarded origin the proxy sets, believed only for allowed Host names (`server/test/labproxy.test.js :: behind the lab-proxy: a write is accepted only with the proxy\'s forwarded origin AND an allowed Host`).
- **Netguard.** Zero real outbound by default: every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect is refused and recorded. A Real call holds a permit for the connection's console origin only, while the operation runs (`server/test/runtimeguard.test.js :: Real holds a permit for the console host of the connection in use while an operation runs`, `server/test/runtimeguard.test.js :: self-test: every route out is refused and recorded, none reaches the network`).
- **A typed console origin is screened for SSRF literals**: no credentials in the URL, no literal private or link-local address, http only on loopback (`server/test/api.test.js :: connections: validation refuses a bad tenant, a private literal host, credentials in the URL and a path on the origin`).

## Modes

- **Mock is the default; Real is an owner opt-in.** Real is refused (403 `real_refused`) unless `PRIVILEGE_EXPLORER_MODE=real` and the bind is loopback; a bare `MODE` is never read (`server/test/mode.test.js :: the guards: Real needs the owner opt-in and a loopback bind (or the container opt-in)`, `server/test/mode.test.js :: modeFrom: mock by default, real only when asked, anything else is an error, a bare MODE is ignored`).
- In Mock mode only loopback-mock connections can be saved; in Real mode the guards must pass (`server/test/mode.test.js :: with Real refused: only a loopback-mock connection can be created; a real origin is refused before anything is stored`).

## The call gate

- Read-only by default: GET runs; POST/PUT need `allowWrites` on the connection; DELETE and PATCH always need it. A blocked call is 403 `writes_disabled` and audited (`server/test/api.test.js :: call proxy: writes are gated. DELETE refuses with writes off; POST works with them on`).
- The operation id must name a catalog operation; the request path is built from the spec's own path template with encoded values, never from raw user text (`server/test/api.test.js :: call proxy: unknown op, missing required path param, and a wrong-credential refusal are honest`).
- The console's own refusals (401/403) surface as `login_required` and land in the audit, redacted (`server/test/api.test.js :: connection test: the probe proves the credential against the mock, and the audit keeps every call`).

## Input hardening

- Unknown routes answer JSON and never echo the path (`server/test/mode.test.js :: an unknown route and a malformed body answer JSON, never an HTML error page that echoes the path`).
- Connection ids are own-key lookups: `__proto__` and `constructor` are not connections (`server/test/mode.test.js :: a connection id is looked up as an own key: __proto__ and constructor are not connections`).
- Diagram names come from a fixed allow-list; prototype-key names resolve to nothing (`server/test/diagrams.test.js :: lookups never reach object prototypes: only the allow-list names resolve`).
- The web UI renders every server-supplied string as a text node (`Untrusted`); a test pins that hostile markup from the server stays inert (`web/src/App.test.jsx :: hostile text from the server never becomes markup`).
- The search is a plain substring match, no user regex, capped length (`server/test/api.test.js :: spec: the full catalog is served, searchable and filterable`).

## Container

- Non-root (`USER node`), read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, no secret baked in (`scripts/compose.test.mjs :: the container hardening stays: non-root, read-only, no capabilities, no secrets baked in`).
- Real is off in the container unless the owner passes `PRIVILEGE_EXPLORER_MODE=real` at run time (`scripts/compose.test.mjs :: Real is off in the container unless the owner passes it: the compose default is mock, and the image sets no mode`).

## No identifiers from other projects

A repo scan refuses any UUID except the placeholder `11111111-2222-4333-8444-555555555555`, any private host, and any key material (`server/test/repo-scan.test.js :: no UUID other than the placeholder, no private host, no key material`).

## What is NOT here

- No OAuth, no interactive sign-in, no token store: the credential is one key/secret pair per connection.
- The `appusertoken` JWT flow (encrypted credentials via an external helper) is not implemented; its encryption scheme is undocumented.

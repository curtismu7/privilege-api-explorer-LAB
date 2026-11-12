# CLAUDE.md

Privilege API Explorer LAB (Tier: Tester, port 7813). Signs in to a PingOne Privilege console with a user API key/secret pair (x-api-key / x-api-secret + x-procyon-session-id), then browses all 447 console API operations from the swagger catalog (substring search + service/method filters) and runs each one with real-time status, timing and response. Read-only by default (writes gated per connection). Mock (an in-process mock console) is the default; Real is owner-run and refused until opted in. Details: [README.md](README.md), [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md). Presenter script: [docs/talk-track.md](docs/talk-track.md).

## Commands (from package.json)

```bash
npm ci
npm test             # server (node --test test/*.test.js) + web (vitest) + scripts/*.test.mjs
npm run build        # builds web/dist, served by the server itself
npm start            # http://127.0.0.1:7813/  (PORT to change)
npm run dev          # API with --watch, Vite on 7815
npm run doctor       # node 26, mode, data dir, bind, port range, netguard self-test, free port (PORT=7816 to dodge a running copy)
npm run reset        # POST /api/reset on the running app
npm run smoke        # the mock console end to end against the running app (removes what it made)
npm run e2e          # headless Chromium on 7814; build first (E2E_CHROMIUM=<binary> if the Playwright build is missing)
npm run content-pack # regenerates and validates content-pack.json (do not hand-edit it)
npm run talk-track   # regenerates docs/talk-track.md (a test fails on drift)
```

Docker (OrbStack, never Docker Desktop): `HOST_PORT=7813 docker compose up --build -d` (publishes `127.0.0.1:` only, `restart: unless-stopped`). Node 26 only.

## Rules that bite here

- **Mock / Real toggle in the header on every page**, the mode shown (`Mode: mock|real`) and the banner saying the same mode, presenter mode included. The page always opens in Mock (nothing about the mode is remembered). **Real is refused** unless `PRIVILEGE_EXPLORER_MODE=real` (shared settings file or environment) and the bind is loopback (a non-loopback `PAE_BIND` counts only with the image's `PAE_CONTAINER=1`): `server/src/config.js` guards, `GET /api/info`, 403 `real_refused` on every route for a non-mock connection. Do not add a path that makes Real work without the owner. Never read a bare `MODE`, never `process.env.MODE`.
- **Zero outbound in Mock.** `server/src/netguard.js` (installed by `index.js`) refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect; a Real operation holds a permit for the console origin of its own connection only (`urls.js` `liveHosts`, `withPermits` in `app.js`). Tests run under the recorder in `server/test/netguard.js` and assert zero attempts.
- **The API secret is write-only.** It is never returned (`store.js` `publicView`), never logged, never audited (`redact.js` scrubs it from every response, error and audit line). Reset keeps connections but turns writes off.
- **Writes are gated.** GET runs; POST/PUT need `allowWrites` on the connection; DELETE and PATCH always need it (`client.js`, gated in `app.js`). A blocked call is 403 `writes_disabled`, audited.
- **Settings.** `~/Development/.env` (or `STANDALONE_ENV`) is READ ONLY, through `util.parseEnv`, one key only (`PRIVILEGE_EXPLORER_MODE`, `settings.js`). No per-app `.env` is loaded. The API secret never goes in it.
- **Loopback only.** Bind `127.0.0.1`; keep the Host check and the same-origin write check (`security.js`) in front of every route. Docker publishes `127.0.0.1:` only. A typed console origin is https (http on loopback only), no credentials in the URL, no literal private address (`isPrivateLiteral` in `urls.js`).
- **CSS standard.** `web/src/styles/standalone-ui.css` is vendored byte-for-byte from `~/Development/AI-DEMO-Standalone/shared/standalone-ui.css` (never edit it) and loads before `app.css`. App CSS: tokens only, no colour literals, no `prefers-color-scheme`, no `!important`, no italics, breakpoints 600/900 only. Check: `bash ~/Development/AI-DEMO-Standalone/scripts/check-css.sh .`
- **No identifiers from other projects.** Test fixtures use `11111111-2222-4333-8444-555555555555` and `.example` / `.invalid` hosts. The forbidden-strings scan must print 0. Never print or copy the forbidden list.
- **Test scripts use globs, never directories** (`node --test test/*.test.js`). Never parse `node:test` stdout: use the exit code.
- **Product claims are UNVERIFIED unless sourced.** Real was verified once against a local desktop console with a scoped key; the cloud console is unverified. The mock tenant is an illustrative sample, not a recording. The `appusertoken` JWT flow is NOT implemented (undocumented encryption scheme).
- The diagram is diagram-studio/1 data (rule 17): `server/diagrams/read.json` and `writes.json`, validated at startup by `server/src/diagrams.js` (copy of the studio validator in `diagramStudioValidate.js`; never import across repos), served by `GET /api/diagrams[/:name]` from a fixed name list, fetched by name in `web/src/pages/Diagram.jsx`. Do not hand-build nodes or edges in the page; edit the JSON (a test pins the layout and step counts). The Dockerfile must `COPY server/diagrams`. Rule 5 stays: movable boxes, Simulate, Reset (also restores positions, from the header Reset too), speed.
- The spec catalog is `server/src/spec-catalog.json` (generated from the Privilege console swagger; do not hand-edit). The search is a plain substring match, never a user regex (ReDoS guard).
- No k8s manifests, no SE build, no hosted mode (deferred by the owner, 2026-10-31); a repo test pins that.

## Where the safety claims are pinned

- `server/test/mode.test.js`, `runtimeguard.test.js`, `netguard.test.js`: Real refused, the guards, the settings reader, the runtime netguard and its permits, zero outbound.
- `server/test/api.test.js`: the gate (connections, secret write-only), the catalog search, the call proxy, the write gate, the audit.
- `server/test/labproxy.test.js`: the lab-proxy Host names and the forwarded same-origin writes.
- `server/test/diagrams.test.js`: diagram-studio/1 data, the loader, the routes.
- `web/src/App.test.jsx`: the header toggle on every page, the banner, the result pane, the refusal message, Reset, inert server text.
- `scripts/repo.test.mjs`: README standard, CSS standard, CI, no k8s/MODE/EC keygen, Real stays an opt-in. `scripts/compose.test.mjs`: loopback-only container publish. `scripts/docs.test.mjs`: docs match the code. `scripts/shelf-entry.test.mjs`, `content-pack.test.mjs`, `talk-track.test.mjs`.

## Shelf and content pack

- Edit `content/terms.json`, then `npm run content-pack`. The catalog id (D3 placeholder until the shelf owner assigns one) appears in the shelf entry, the pack and the README; a test pins all three.
- The shelf entry is `docs/shelf-entry.json` (port 7813, relative `composeFile`); `scripts/lib/shelf-registry-rules.mjs` is a copy of the shelf's rules. Change the port or id only with the shelf owner.
- Run check-drift, check-css and conformance by hand: `bash ~/Development/AI-DEMO-Standalone/scripts/check-drift.sh .`, `node ~/Development/demo-kit-base/scripts/conformance.mjs . --new`.

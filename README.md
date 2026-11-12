# Privilege API Explorer LAB

A standalone app that signs in to a PingOne Privilege console with a user API key and secret, then browses **all 447 console API operations** from the swagger catalog — substring search ("pi" shows every `pi*` path), service and method filters — and runs each one live with real-time status, timing and response. Read-only by default. Mock by default; Real is owner-run.

Tier: Tester
Repo: https://github.com/curtismu7/privilege-api-explorer-LAB
Catalog: D131

> **Nothing here is verified against a cloud Privilege tenant.** Mock mode is an in-process mock of the Privilege console API. Real mode was verified once, by the owner, against a local desktop console (`local.procyon.ai:8643`) with a scoped key/secret pair: applications, users and pacpolicys answered 200; admin collections (`tenantapikeys`, `tenantprofile`) answer the console's own 401/500, which the explorer shows as-is. The header has a **Mock / Real** toggle and shows the mode; **Real is refused** until the owner opts in, and the banner on every tab, presenter mode included, names the mode.

## What is simulated

**Mock mode (the default, and the only mode that runs with no setup).** The mock console talks to an in-process mock of the Privilege console API on this machine (loopback only). The sample tenant is an illustrative sample, not a recording: imodel-shaped users, applications, policies and agent keys, with the key collections modelled. Write calls change only that in-memory sample. Nothing leaves this machine: a netguard refuses every non-loopback socket, DNS lookup, fetch and UDP send, and a test asserts zero attempts over a whole Mock session. The banner says the same.

**Real mode (owner-run).** The saved connection talks to the real Privilege console origin you name, with your saved API key and secret (`x-api-key` / `x-api-secret` + a fresh `x-procyon-session-id` per call), and acts on it. Writes are off per connection; DELETE and PATCH always need the switch. Real is refused until the owner sets `PRIVILEGE_EXPLORER_MODE=real` (see "Settings"), and even then the netguard lets a connection reach only its own console origin. The console's own refusals (401 wrong credential, 403 scope too small, 500 operation not allowed) are passed through and shown as-is.

The API catalog is the Privilege console's own swagger (`imodel.swagger.json`, Swagger 2.0 snapshot) reduced to 447 operations across 92 services. The `appusertoken` JWT flow (encrypted credentials via a Go helper) is **not** implemented: the encryption scheme is undocumented and the helper was not available. If Ping publishes it, the JWT flow can be added beside the key/secret scheme.

## Run from a clone

Prerequisites: Node 26 or newer (`.nvmrc` says 26). Docker only for the Docker form.

```bash
git clone https://github.com/curtismu7/privilege-api-explorer-LAB.git
cd privilege-api-explorer-LAB
npm ci
npm run doctor      # node, mode, bind, data directory, port range, netguard self-test, free port
npm run build       # builds web/dist, which the server serves itself
npm start           # then open http://127.0.0.1:7813/
```

Mock mode needs no setup at all: no settings file, no account, no network. Open the page, press **Add mock console connection** on Connections, and try the Explorer (search "pi", open an operation, press Call), the Audit log and the Diagram.

```bash
curl -s http://127.0.0.1:7813/api/health
curl -s http://127.0.0.1:7813/api/info
npm run smoke       # the mock console end to end against the running app, then removes what it made
```

Development: `npm run dev` starts the API (`node --watch`) and the Vite dev server on `127.0.0.1:7815`, which proxies `/api`. `npm run e2e` drives headless Chromium against the built UI and in-process stubs (needs `npm run build` first and `npx playwright install chromium`; set `E2E_CHROMIUM` to a Chromium binary if the pinned Playwright build is missing).

## Real mode (owner-run)

1. Set `PRIVILEGE_EXPLORER_MODE=real` (shared settings file or environment). The page still opens in Mock; press **Real** in the header.
2. On Connections, add a connection: the console **origin** (e.g. the local desktop console's `https://local.procyon.ai:8643`), the **tenant UUID** (shown in the console URL), and your **API key + secret** (Settings → For Developers in the Privilege console).
3. Tick "self-signed certificate" if the console is the local desktop app.
4. Press **Test connection**: one real GET against the console proves the credential.
5. Enable writes per connection only when you intend to write. DELETE and PATCH always need it.

## Settings file

All standalone apps read one settings file, `~/Development/.env` (mode 600). `STANDALONE_ENV=/path/to/file` overrides the path. This app reads it with `util.parseEnv`, only reads it (never writes it), and takes only `PRIVILEGE_EXPLORER_MODE`; every other key in the file is ignored and never enters the server's environment. A bare `MODE` is never read.

No API secret belongs in this file, and none is read from it. The saved connections (including the API secret, which is write-only: never returned, never logged) live in the app's own owner-only folder (`.data`, or `PAE_DATA_DIR`; mode 700, files mode 600). `.env.example` lists every environment variable. The port is not in the settings file: apps keep their port defaults in code.

## Ports, and what to do if the port is taken

Ports: privilege-api-explorer listens on 7813 (set with PORT).
Port range for new standalone apps: 7800-7999 (this app holds 7813).

If the port is taken:
1. Find what is using it:

```bash
lsof -iTCP:7813 -sTCP:LISTEN -n -P
```

2. Run this app on another port in the range: `PORT=7816 npm start` (the doctor accepts 7800-7999).

Docker: `HOST_PORT=7813 docker compose up --build -d` (OrbStack, never Docker Desktop). The container publishes `127.0.0.1:` only — a test pins it — and Real still needs the owner opt-in at run time.

## Tests

```bash
npm test            # server (node --test) + web (vitest) + scripts/*.test.mjs
npm run doctor
npm run content-pack
```

The security model and every pinned rule are in [docs/security.md](docs/security.md); the architecture is in [docs/architecture.md](docs/architecture.md). The presenter script is [docs/talk-track.md](docs/talk-track.md).

## Reset

Reset (header button, or `npm run reset` against a running app) clears the audit history, restores the mock tenant and turns writes off on every connection. Saved connections and their secrets are kept.

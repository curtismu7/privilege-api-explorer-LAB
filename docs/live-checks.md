# Real-console checks (owner-run, partly verified once)

Real mode was verified **once** by the owner against the **local desktop Privilege console** (`local.procyon.ai:8643`) with a scoped user API key: `applications`, `users` and `pacpolicys` answered 200; admin collections (`tenantapikeys`, `tenantprofile`) answered the console's own 401/500 "operation not allowed", which the explorer passes through. Nothing below that line is verified against a **cloud** Privilege tenant or the SE host. Run these yourself, with a console you own, and record the result using the evidence template at the end. Use a **throwaway** tenant if you can: check 5 performs a real write.

## Before you start

- Your own console origin (for example the local desktop console), the tenant UUID (from the console URL), and a user API key + secret from Settings → For Developers, with the least scope you can. The secret is never committed; you type it into a connection.
- Run the app (`npm start`, or `HOST_PORT=7813 docker compose up --build -d`). Open `http://localhost:7813`, press **Real** in the header (needs `PRIVILEGE_EXPLORER_MODE=real`).
- Writes stay **off** until check 5.

## Checks

1. The key works: press **Test connection**. Expected: the probe GET on `/v1/users` answers 200 (or the console's own refusal, shown as-is).
2. Scope mapping: which collections your key may read. Browse the catalog service by service; record which answer 200 and which answer 401/403/500.
3. The session-id header: confirm the console accepts any UUID value (we measured it is unvalidated) and that omitting it is a 400.
4. One read call in the Explorer: open a GET operation, press **Call**, record the status, the ms and the body shape.
5. One gated write on a throwaway object (only after checks 1 to 4): enable writes on the connection (the red banner appears), run a POST for a throwaway object named so you can recognise it, then verify in the console that it exists. Delete it in the console (or with the gated DELETE), then turn writes off again.
6. The `appusertoken` JWT flow: if Ping publishes the encrypt/decrypt helper's scheme, the JWT login from the console docs can be added beside the key/secret scheme. Until then it is not implemented.
7. Self-signed certificate: on the local desktop console, tick "self-signed certificate" on the connection; on a cloud console it must stay off.

## Stop if

- The connection banner says **REAL mode** and you do not recognise the console origin or the tenant, or it is a tenant you do not own or are not allowed to change.

## Evidence template

```
- When: <date>
- Console: <origin, e.g. the local desktop console> Tenant: <tenant UUID>
- Key scope: <what the key may do>
- Check 1 (test): <status, ms>
- Check 2 (scope map): <collection -> status>
- Check 3 (session id): <measured>
- Check 4 (read): <operation, status, ms>
- Check 5 (write): <created object, verified yes/no, deleted yes/no>
- Anything the console answered differently from the mock: <notes>
```

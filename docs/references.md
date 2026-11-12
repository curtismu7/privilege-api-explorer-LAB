# References

Every Privilege or console behaviour this app states comes from one of these. Anything else is labelled UNVERIFIED in the UI and in [live-checks.md](live-checks.md).

| Claim | Source |
| --- | --- |
| The console API surface: `/api/{tenant}/v1/...`, 447 operations across 92 services, imodel* object shapes, the operation paths and parameters | the Privilege console's own swagger (`imodel.swagger.json`, Swagger 2.0; snapshot reduced to `server/src/spec-catalog.json`) |
| The key/secret header scheme (`x-api-key`, `x-api-secret`, `Authorization: Basic`), `x-procyon-session-id` required with an unvalidated value, read-modify-write PUT semantics, "no policy = deny all" | the `privilege-console-api` skill in AI-DEMO2 (`.claude/skills/privilege-console-api/SKILL.md`), proven live 2026-10-11 |
| The verified-once real answers: local desktop console 200 on applications/users/pacpolicys with a scoped key; `tenantapikeys`/`tenantprofile` 500 "operation not allowed"; the SE host 401 for that key | owner-run check 2026-11-11, recorded in [live-checks.md](live-checks.md) |
| The `appusertoken` JWT flow exists but is NOT implemented (encrypted credentials via an undocumented Go helper) | the owner's console notes ("User API Key & Secret Management"); the scheme itself is UNVERIFIED — no helper or wire format was available |
| Connection store (mode 600), redaction, loopback/Host/same-origin guards, netguard with permits | the family standalone pattern (`mcp-tools`, `pingone-mcp-inspector-LAB`, same authors, MIT), copied with a header comment in each file |
| Learning Hub pack format `demo-content-pack/1` | the ID-JAG kit's `docs/content-pack.schema.json` (copied to `docs/`), validator pattern from the family |
| Container shape, loopback-only publish test, `restart: unless-stopped` | the family `Dockerfile` / `docker-compose.yml` pattern |
| Shelf registry entry | the demo-shelf repo's rules (copied into `scripts/lib/shelf-registry-rules.mjs`) |
| Health contract `demo-health/1` | the demo-shelf repo's `docs/health-contract.md` |
| Sample tenant objects | illustrative sample, not a recording |

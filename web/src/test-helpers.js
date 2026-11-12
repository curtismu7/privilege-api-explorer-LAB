import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

// The real diagram-studio/1 files the server serves, so the web tests render the same data the app does.
const DIAGRAMS = Object.fromEntries(["read", "writes"].map((n) => [n, JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "diagrams", `${n}.json`), "utf8"))]));

export const TENANT = "11111111-2222-4333-8444-555555555555"; // placeholder, not a tenant
export const conn = (o = {}) => ({ id: "c1", kind: "privilege", label: "Mock console (sample tenant)", url: "http://127.0.0.1:9000", tenant: TENANT, apiKey: "demo-key-1111", apiSecret: "set", allowWrites: false, ...o });

export const OPS = [
  { id: "op-1", method: "GET", path: "/api/{ObjectMeta.Tenant}/v1/users", tag: "UserService", summary: "List users", params: [{ name: "ObjectMeta.Tenant", in: "path", required: true, type: "string" }, { name: "ObjectMeta.Namespace", in: "query", required: false, type: "string" }] },
  { id: "op-2", method: "GET", path: "/api/{ObjectMeta.Tenant}/v1/applications", tag: "ApplicationService", summary: "List applications", params: [{ name: "ObjectMeta.Tenant", in: "path", required: true, type: "string" }] },
  { id: "op-3", method: "POST", path: "/api/{ObjectMeta.Tenant}/v1/users", tag: "UserService", summary: "Create a user", params: [{ name: "ObjectMeta.Tenant", in: "path", required: true, type: "string" }, { name: "body", in: "body", required: true, type: "string" }] },
  { id: "op-4", method: "DELETE", path: "/api/{ObjectMeta.Tenant}/v1/users/{ObjectMeta.Namespace}/{ObjectMeta.Name}", tag: "UserService", summary: "Delete a user", params: [{ name: "ObjectMeta.Tenant", in: "path", required: true, type: "string" }, { name: "ObjectMeta.Namespace", in: "path", required: true, type: "string" }, { name: "ObjectMeta.Name", in: "path", required: true, type: "string" }] },
];
const SPEC = { total: 447, matched: OPS.length, byMethod: { GET: 2, POST: 1, DELETE: 1 }, tags: ["ApplicationService", "UserService"], operations: OPS };

export const REAL_OK = { available: true, failed: [], needs: [] };
export const REAL_REFUSED = { available: false, failed: ["owner-opt-in"], needs: ["PRIVILEGE_EXPLORER_MODE=real is set in the shared settings file"] };
// A tiny fake of this app's API. `calls` records every request; handlers can be overridden per test.
export function fakeApi({ conns = [conn()], audit = [], handlers = {}, real = REAL_OK, spec = SPEC } = {}) {
  const state = { conns: structuredClone(conns), calls: [], audit };
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: Promise.resolve(JSON.stringify(body)) });
  let serverMode = "mock";
  globalThis.fetch = vi.fn((url, init = {}) => {
    const method = init.method || "GET"; const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, url, body });
    const key = `${method} ${url.replace(/c1|c2/, ":id").replace(/\?.*$/, "")}`;
    if (handlers[key]) return handlers[key](body, state, json);
    switch (key) {
      case "GET /api/info": return json(200, { mode: serverMode, source: serverMode, modes: ["mock", "real"], key: "PRIVILEGE_EXPLORER_MODE", requested: serverMode, real });
      case "POST /api/mode":
        if (body.source === "real" && !real.available) return json(409, { error: "real_not_available", message: "Real is refused: owner-opt-in." });
        serverMode = body.source; return json(200, { source: serverMode, realAvailable: real.available, realReason: null });
      case "POST /api/reset": return json(200, { ok: true, cleared: ["audit history", "mock tenant"], kept: ["connections"] });
      case "GET /api/connections": return json(200, { connections: state.conns });
      case "POST /api/connections": { const c = conn({ id: "c2", ...body, apiSecret: body.apiSecret ? "set" : undefined, allowWrites: false }); state.conns.push(c); return json(201, c); }
      case "POST /api/mock-url": return json(200, { base: "http://127.0.0.1:9000", tenant: TENANT, apiKey: "demo-key-1111", apiSecret: "demo-secret-2222", fixture: "illustrative sample, not a recording" });
      case "POST /api/connections/:id/test": return json(200, { ok: true, status: 200, ms: 12, probed: `/api/${TENANT}/v1/users?ObjectMeta.Namespace=default` });
      case "POST /api/connections/:id/settings": state.conns[0].allowWrites = body.allowWrites; return json(200, state.conns[0]);
      case "GET /api/spec": return json(200, spec);
      case "GET /api/spec/ops/op-1": return json(200, OPS[0]);
      case "GET /api/spec/ops/op-3": return json(200, OPS[2]);
      case "GET /api/spec/ops/op-4": return json(200, OPS[3]);
      case "POST /api/connections/:id/call": return json(200, { status: 200, ms: 15, path: `/api/${TENANT}/v1/users`, sessionId: "sess-1", body: { Users: [{ ObjectMeta: { Name: "users-sample-1" } }] } });
      case "GET /api/diagrams": return json(200, { diagrams: Object.values(DIAGRAMS).map((d) => ({ name: d.id, title: d.title })) });
      case "GET /api/diagrams/read": return json(200, DIAGRAMS.read);
      case "GET /api/diagrams/writes": return json(200, DIAGRAMS.writes);
      case "GET /api/audit": return json(200, { entries: state.audit });
      default: return json(404, { error: "not_found", message: `unhandled ${key}` });
    }
  });
  return state;
}

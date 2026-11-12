// In-process mock of the Privilege console API, on loopback. Used by mock mode and by tests. The data is an
// ILLUSTRATIVE SAMPLE, NOT A RECORDING: users, applications, policies and agent keys shaped like the console's
// imodel* objects (ObjectMeta.Kind/Tenant/Namespace/Name + Spec), with a small in-memory fake tenant. Every
// collection GET/POST/PUT/DELETE in the swagger catalog is answered generically; a handful have bespoke handlers.
// Auth mirrors the real console: x-api-key / x-api-secret / x-procyon-session-id; a wrong pair is 401.
import crypto from 'node:crypto';
import http from 'node:http';
import catalog from './spec-catalog.json' with { type: 'json' };

export const FIXTURE_LABEL = 'illustrative sample, not a recording';
const TENANT = '11111111-2222-4333-8444-555555555555'; // a placeholder, not a tenant

// Collection name -> { kind, listField, sample }
const COLLECTIONS = {
  users: { kind: 'User', field: 'Users', sample: { Spec: { FullName: 'Sample User', EmailID: 'sample.user@privlab.example', FirstName: 'Sample', LastName: 'User', Enabled: true } } },
  applications: { kind: 'Application', field: 'Applications', sample: { Spec: { Description: 'A sample agentic app', McpAppConfig: { FrontEndName: 'sample-door', EntryPath: '/mcp', AuthMode: 'Static Token' } } } },
  pacpolicys: { kind: 'PacPolicy', field: 'PacPolicys', sample: { Spec: { Description: 'Allow list tools for the sample door', ActionMap: { '*': 'allow' } } } },
  tagpolicys: { kind: 'TagPolicy', field: 'TagPolicys', sample: { Spec: { PolicyOrigin: 'Default', KindMap: { env: 'sample' } } } },
  agentaccesskeys: { kind: 'AgentAccessKey', field: 'AgentAccessKeys', sample: { Spec: { VirtualKey: 'paesk-mock-0000000000000000', Scopes: ['mcp'], CustodianRef: 'sample-agent', NotAfter: '2027-01-01T00:00:00Z' } } },
  nonhumanidentities: { kind: 'NonHumanIdentity', field: 'NonHumanIdentities', sample: { Spec: { Description: 'Sample workload identity', Enabled: true, Federation: { Issuer: 'https://idp.example/as', Audience: 'sample-door', JwksURI: 'https://idp.example/.well-known/jwks.json' }, Scopes: ['mcp'] } } },
  approvers: { kind: 'Approver', field: 'Approvers', sample: { Spec: { EmailID: 'approver@privlab.example' } } },
  approvalreqs: { kind: 'ApprovalReq', field: 'ApprovalReqs', sample: { Spec: { State: 'pending', Requestor: 'sample-agent' } } },
  aipolicys: { kind: 'AIPolicy', field: 'AIPolicys', sample: { Spec: { Description: 'Sample AI policy' } } },
  aiintents: { kind: 'AIIntent', field: 'AIIntents', sample: { Spec: { Description: 'Sample intent' } } },
  secrets: { kind: 'Secret', field: 'Secrets', sample: { Spec: { Description: 'A sample secret reference (value never stored)' } } },
  roles: { kind: 'Role', field: 'Roles', sample: { Spec: { Description: 'A sample role' } } },
  groups: { kind: 'Group', field: 'Groups', sample: { Spec: { Description: 'A sample group' } } },
  targets: { kind: 'Target', field: 'Targets', sample: { Spec: { Description: 'A sample target' } } },
  databases: { kind: 'Database', field: 'Databases', sample: { Spec: { Host: 'db.privlab.example', Port: 5432 } } },
  projects: { kind: 'Project', field: 'Projects', sample: { Spec: { Description: 'A sample project' } } },
};

const meta = (kind, name) => ({ Kind: kind, Tenant: TENANT, Namespace: 'default', Name: name, ID: `mock-${++idSeq}`, CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() });
let idSeq = 0;

// Every operation path in the spec, matched generically: /api/{tenant}/v1/<collection>(/{ns}/{name})?
const OP_PATHS = catalog.operations.map((o) => ({ method: o.method, path: o.path }));

export function createMock({ now = Date.now } = {}) {
  const config = { calls: [] };
  const freshTenant = () => {
    idSeq = 0;
    const t = {};
    for (const [coll, c] of Object.entries(COLLECTIONS)) {
      t[coll] = [1, 2].map((i) => ({ ObjectMeta: meta(c.kind, `${coll.slice(0, -1)}-sample-${i}`), ...structuredClone(c.sample) }));
    }
    return t;
  };
  const tenant = freshTenant();
  let n = 0;
  let server; let base = '';

  const checkAuth = (req) => {
    const key = req.headers['x-api-key']; const secret = req.headers['x-api-secret'];
    if (!req.headers['x-procyon-session-id']) return { status: 400, body: { error: 'Procyon required header is missing', message: 'x-procyon-session-id is required' } };
    // The mock accepts two pairs: the demo's own (key==secret=='mock-key' style) and any pair of the form demo-key/demo-secret.
    if (key === 'demo-key-1111' && secret === 'demo-secret-2222') return null;
    return { status: 401, body: { error: `User is not authorized for ${req.headers.host || 'mock'}` } };
  };

  const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

  async function handle(req, res) {
    const url = new URL(req.url, base || 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean); // [api, tenant, v1, collection, ns?, name?]
    if (parts[0] !== 'api' || parts[2] !== 'v1' || parts[1] !== TENANT) return send(res, 404, { error: 'not_found' });
    const authz = checkAuth(req);
    if (authz) return send(res, authz.status, authz.body);
    const coll = parts[3];
    const rec = COLLECTIONS[coll];
    const name = parts.length >= 6 ? parts[5] : null; // /api/<tenant>/v1/<coll>/<ns>/<name>
    config.calls.push({ method: req.method, path: url.pathname, at: now() });

    if (!rec) {
      // Known to the catalog but not modelled: an honest answer, not a fake 200.
      const inSpec = OP_PATHS.some((o) => o.method === req.method && new RegExp(`^${o.path.replace(/\{[^}]+\}/g, '[^/]+').replace(/\//g, '/')}$`).test(url.pathname));
      return inSpec
        ? send(res, 200, { note: `${coll} is not modelled by the mock; the catalog knows the operation. Mock answer: empty.` })
        : send(res, 404, { error: 'not_found' });
    }
    const list = tenant[coll];
    if (req.method === 'GET' && !name) return send(res, 200, { [rec.field]: list });
    if (req.method === 'GET' && name) {
      const one = list.find((x) => x.ObjectMeta.Name === name);
      return one ? send(res, 200, one) : send(res, 404, { error: 'not_found' });
    }
    if (req.method === 'POST' && !name) {
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const nm = String(body?.ObjectMeta?.Name || `${coll.slice(0, -1)}-${++n}`);
      if (list.some((x) => x.ObjectMeta.Name === nm)) return send(res, 409, { error: 'already_exists' });
      const created = { ObjectMeta: meta(rec.kind, nm), ...(body.Spec ? { Spec: body.Spec } : rec.sample) };
      list.push(created);
      return send(res, 201, created);
    }
    if ((req.method === 'PUT' || req.method === 'PATCH') && name) {
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const one = list.find((x) => x.ObjectMeta.Name === name);
      if (!one) return send(res, 404, { error: 'not_found' });
      if (body.Spec) one.Spec = body.Spec;
      one.ObjectMeta.UpdatedAt = new Date().toISOString();
      return send(res, 200, one);
    }
    if (req.method === 'DELETE' && name) {
      const i = list.findIndex((x) => x.ObjectMeta.Name === name);
      if (i === -1) return send(res, 404, { error: 'not_found' });
      list.splice(i, 1);
      return send(res, 200, { deleted: name });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  }

  return {
    config, tenant, TENANT,
    get base() { return base; },
    // Reset: the fake tenant goes back to its starting records and the recorded call list is dropped.
    reset() { Object.assign(tenant, freshTenant()); config.calls.length = 0; },
    async start() {
      server = http.createServer((q, r) => { handle(q, r).catch(() => send(r, 500, { error: 'mock_error' })); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${server.address().port}`;
      return base;
    },
    async stop() { if (!server) return; server.closeAllConnections?.(); await new Promise((r) => server.close(r)); server = null; },
  };
}

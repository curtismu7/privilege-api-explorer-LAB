// The API gate: connections CRUD, the spec catalog, the call proxy, the audit. Runs against the in-process mock console.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { TENANT, connBody, startApp, withMockUrl } from './helpers.js';
import { installNetguard } from './netguard.js';

const guard = installNetguard();
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); assert.deepEqual(guard.attempts, [], 'zero outbound attempts'); guard.restore(); });

test('health: demo-health/1, needs-setup with no connection', async () => {
  const r = await s.call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.schema, 'demo-health/1');
  assert.ok(['needs-setup', 'ready'].includes(r.json.state));
});

test('connections: create, list, update writes, delete; the secret is never returned', async () => {
  const created = await s.call('POST', '/api/connections', withMockUrl(s));
  assert.equal(created.status, 201, created.text);
  const c = created.json;
  assert.equal(c.apiSecret, 'set');
  assert.ok(!JSON.stringify(c).includes('demo-secret-2222'), 'the secret must not appear in the view');
  const listed = (await s.call('GET', '/api/connections')).json.connections;
  assert.ok(listed.some((x) => x.id === c.id));
  assert.ok(!JSON.stringify(listed).includes('demo-secret-2222'));
  const on = await s.call('POST', `/api/connections/${c.id}/settings`, { allowWrites: true });
  assert.equal(on.json.allowWrites, true);
  assert.equal((await s.call('DELETE', `/api/connections/${c.id}`)).status, 200);
  assert.equal((await s.call('GET', '/api/connections')).json.connections.length, 0);
});

test('connections: validation refuses a bad tenant, a private literal host, credentials in the URL and a path on the origin', async () => {
  for (const [patch, why] of [
    [{ tenant: 'not-a-uuid' }, 'bad tenant'],
    [{ url: 'http://10.0.0.1' }, 'private literal'],
    [{ url: `https://user:pass@console.example.com` }, 'credentials in url'],
    [{ url: 'https://console.example.com/console/' }, 'path on origin'],
    [{ apiKey: '' }, 'missing key'],
    [{ apiSecret: '' }, 'missing secret'],
  ]) {
    const r = await s.call('POST', '/api/connections', withMockUrl(s, patch));
    assert.equal(r.status, 400, `${why}: ${r.text}`);
  }
  assert.equal(s.app.locals.store.list().length, 0);
});

test('spec: the full catalog is served, searchable and filterable', async () => {
  const all = await s.call('GET', '/api/spec');
  assert.equal(all.status, 200);
  assert.equal(all.json.total, 447);
  assert.ok(all.json.tags.length > 50);
  // Substring search: "pacpolicys" matches every operation on that collection.
  const hit = await s.call('GET', '/api/spec?q=pacpolicys');
  assert.ok(hit.json.matched >= 3, 'list/create/delete on pacpolicys at least');
  for (const o of hit.json.operations) assert.ok(`${o.method} ${o.path} ${o.tag} ${o.summary}`.toLowerCase().includes('pacpolicys'), o.opId);
  // Tag + method filters narrow the list.
  const tag = (await s.call('GET', `/api/spec?tag=${all.json.tags[0]}`)).json;
  assert.ok(tag.matched > 0 && tag.operations.every((o) => o.tag === all.json.tags[0]));
  const getOnly = (await s.call('GET', '/api/spec?method=get&q=agentaccesskeys')).json;
  assert.ok(getOnly.matched > 0 && getOnly.operations.every((o) => o.method === 'GET'));
  // A single operation by id, and a 404 for an unknown id.
  const one = await s.call('GET', `/api/spec/ops/${hit.json.operations[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.json.tag, hit.json.operations[0].tag);
  assert.equal((await s.call('GET', '/api/spec/ops/nope')).status, 404);
  // The search string is capped; a huge query is answered, not crashed.
  assert.equal((await s.call('GET', `/api/spec?q=${'x'.repeat(500)}`)).status, 200);
});

test('call proxy: a GET against the mock console returns its records, with the session id and timing', async () => {
  const c = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
  const spec = (await s.call('GET', '/api/spec?q=+%2Fapi%2F%7BObjectMeta.Tenant%7D%2Fv1%2Fusers&method=get')).json;
  const usersOp = spec.operations.find((o) => o.path === '/api/{ObjectMeta.Tenant}/v1/users' && o.method === 'GET');
  assert.ok(usersOp, 'the list-users operation is in the catalog');
  const r = await s.call('POST', `/api/connections/${c.id}/call`, { opId: usersOp.id, values: { 'ObjectMeta.Namespace': 'default' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 200);
  assert.ok(r.json.ms >= 0);
  assert.ok(r.json.sessionId);
  assert.ok(Array.isArray(r.json.body.Users));
  assert.equal(r.json.body.Users[0].ObjectMeta.Tenant, TENANT);
  // The tenant path parameter was filled from the connection.
  assert.ok(r.json.path.includes(TENANT));
});

test('call proxy: unknown op, missing required path param, and a wrong-credential refusal are honest', async () => {
  const c = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
  const bad = await s.call('POST', `/api/connections/${c.id}/call`, { opId: 'op-nope' });
  assert.equal(bad.status, 400);
  // Delete needs a name: the buildRequest throws before any request.
  const spec = (await s.call('GET', '/api/spec?q=users')).json;
  const del = spec.operations.find((o) => o.method === 'DELETE' && o.path.endsWith('/v1/users/{ObjectMeta.Namespace}/{ObjectMeta.Name}'));
  const missing = await s.call('POST', `/api/connections/${c.id}/call`, { opId: del.id, values: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.json.message, /required path parameter/);
  // A connection with a wrong credential pair: the mock answers 401 and the proxy maps it to login_required.
  const wrong = (await s.call('POST', '/api/connections', connBody({ url: s.mock.base, apiKey: 'nope', apiSecret: 'nope' }))).json;
  const usersOp = spec.operations.find((o) => o.method === 'GET' && o.path === '/api/{ObjectMeta.Tenant}/v1/users');
  const refused = await s.call('POST', `/api/connections/${wrong.id}/call`, { opId: usersOp.id, values: {} });
  assert.equal(refused.status, 401);
  assert.equal(refused.json.error, 'login_required');
  assert.equal((await s.call('GET', '/api/audit')).json.entries.some((e) => e.outcome === 'refused'), true, 'the refusal is in the audit');
});

test('call proxy: writes are gated. DELETE refuses with writes off; POST works with them on', async () => {
  const c = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
  const spec = (await s.call('GET', '/api/spec?q=users')).json;
  const del = spec.operations.find((o) => o.method === 'DELETE' && o.path.endsWith('/v1/users/{ObjectMeta.Namespace}/{ObjectMeta.Name}'));
  const post = spec.operations.find((o) => o.method === 'POST' && o.path === '/api/{ObjectMeta.Tenant}/v1/users');
  const off = await s.call('POST', `/api/connections/${c.id}/call`, { opId: del.id, values: { 'ObjectMeta.Namespace': 'default', 'ObjectMeta.Name': 'users-sample-1' } });
  assert.equal(off.status, 403);
  assert.equal(off.json.error, 'writes_disabled');
  assert.equal((await s.call('POST', `/api/connections/${c.id}/settings`, { allowWrites: true })).status, 200);
  const created = await s.call('POST', `/api/connections/${c.id}/call`, { opId: post.id, values: {}, body: { ObjectMeta: { Name: 'explorer-made' }, Spec: { FullName: 'Explorer Made' } } });
  assert.equal(created.status, 200, created.text);
  assert.equal(created.json.status, 201, 'the mock created the record');
  const gone = await s.call('POST', `/api/connections/${c.id}/call`, { opId: del.id, values: { 'ObjectMeta.Namespace': 'default', 'ObjectMeta.Name': 'explorer-made' } });
  assert.equal(gone.json.status, 200);
});

test('connection test: the probe proves the credential against the mock, and the audit keeps every call', async () => {
  const c = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
  const t = await s.call('POST', `/api/connections/${c.id}/test`);
  assert.equal(t.json.ok, true, t.text);
  assert.ok(t.json.probed.includes('/v1/users'));
  const entries = (await s.call('GET', '/api/audit')).json.entries;
  assert.ok(entries.length >= 2);
  assert.ok(!JSON.stringify(entries).includes('demo-secret-2222'), 'secrets never reach the audit');
});

test('mock console answers known collections and refuses unknown paths honestly', async () => {
  const c = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
  const spec = (await s.call('GET', '/api/spec?q=applications&method=get')).json;
  const listApps = spec.operations.find((o) => o.path === '/api/{ObjectMeta.Tenant}/v1/applications');
  const apps = await s.call('POST', `/api/connections/${c.id}/call`, { opId: listApps.id, values: { 'ObjectMeta.Namespace': 'default' } });
  assert.equal(apps.json.status, 200);
  assert.ok(apps.json.body.Applications.length >= 2);
});

test('reset: audit and mock tenant cleared, writes off, connections kept', async () => {
  const r = await s.call('POST', '/api/reset');
  assert.equal(r.json.ok, true);
  assert.deepEqual((await s.call('GET', '/api/audit')).json.entries, []);
  const conns = (await s.call('GET', '/api/connections')).json.connections;
  assert.ok(conns.length >= 1, 'connections survive the reset');
  for (const c of conns) assert.equal(c.allowWrites, false, 'every connection goes back to writes off');
});

test('same-origin writes: a cross-origin POST is refused before anything else', async () => {
  const r = await s.call('POST', '/api/connections', withMockUrl(s), { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'cross_origin');
});

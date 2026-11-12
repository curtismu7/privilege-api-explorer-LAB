#!/usr/bin/env node
// The minimum end-to-end check against a RUNNING app (npm start, or the Docker container): health, the mode, the mock console end
// to end (mock url, add, test, one read call, a gated write, the spec search), and Reset. It uses the in-process mock only and removes
// the connection it made, so it never reaches a real console even if Real is set up on this machine. Prints one line per check, exits 1
// on a failure. Loopback only.
//   node scripts/smoke.mjs [base-url]      (default http://127.0.0.1:${PORT:-7813})
import { isLoopbackHost } from '../server/src/security.js';

const base = new URL(process.argv[2] || `http://127.0.0.1:${process.env.PORT || 7813}`);
if (!isLoopbackHost(base.hostname)) { console.error(`refusing ${base.hostname}: loopback only`); process.exit(1); }
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed += 1; };
const send = async (method, p, body) => {
  const r = await fetch(new URL(p, base), { method, headers: { 'content-type': 'application/json', origin: base.origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
};
let madeId = null;

try {
  const h = await send('GET', '/api/health');
  check(h.status === 200 && h.json.schema === 'demo-health/1' && h.json.state !== 'broken', 'GET /api/health is demo-health/1 and not broken');
  const i = await send('GET', '/api/info');
  check(i.status === 200 && i.json.mode === 'mock' && typeof i.json.real?.available === 'boolean', `GET /api/info: the page opens in Mock (Real is ${i.json.real?.available ? 'allowed by the owner' : 'refused'})`);
  const mu = await send('GET', '/api/mock-url');
  check(mu.status === 200 && mu.json.base && mu.json.fixture, 'GET /api/mock-url: the in-process mock is up and labelled');
  const made = await send('POST', '/api/connections', { kind: 'privilege', label: 'smoke (removed)', url: mu.json.base, tenant: mu.json.tenant, apiKey: mu.json.apiKey, apiSecret: mu.json.apiSecret });
  madeId = made.json?.id ?? null;
  check(made.status === 201 && madeId, 'POST /api/connections: the mock console connection is added');
  const t = await send('POST', `/api/connections/${madeId}/test`);
  check(t.status === 200 && t.json.ok === true, `POST .../test: the credential is accepted on ${t.json?.probed || '?'}`);
  const spec = await send('GET', '/api/spec?q=pi');
  check(spec.status === 200 && spec.json.total === 447 && spec.json.matched > 0, `GET /api/spec?q=pi: ${spec.json?.matched} of ${spec.json?.total} operations match "pi"`);
  const usersOp = (await send('GET', '/api/spec?q=users&method=get')).json.operations.find((o) => o.path === '/api/{ObjectMeta.Tenant}/v1/users');
  const call = await send('POST', `/api/connections/${madeId}/call`, { opId: usersOp.id, values: { 'ObjectMeta.Namespace': 'default' } });
  check(call.status === 200 && call.json.status === 200 && Array.isArray(call.json.body?.Users), `POST .../call: the read runs (${call.json?.ms} ms, ${call.json?.body?.Users?.length} sample users)`);
  const del = (await send('GET', '/api/spec?q=users&method=delete')).json.operations.find((o) => o.method === 'DELETE');
  const w = await send('POST', `/api/connections/${madeId}/call`, { opId: del.id, values: { 'ObjectMeta.Namespace': 'default', 'ObjectMeta.Name': 'x' } });
  check(w.status === 403 && w.json.error === 'writes_disabled', 'POST .../call: a destructive call is refused while writes are off');
  const z = await send('POST', '/api/reset', {});
  check(z.status === 200 && z.json.ok === true, 'POST /api/reset: ok');
} catch (e) { check(false, `the app did not answer at ${base.origin}: ${e.message}`); }
if (madeId) {
  try { const d = await send('DELETE', `/api/connections/${madeId}`); check(d.status === 200, 'DELETE: the smoke connection is removed'); }
  catch (e) { check(false, `could not remove the smoke connection: ${e.message}`); }
}
process.exit(failed ? 1 : 0);

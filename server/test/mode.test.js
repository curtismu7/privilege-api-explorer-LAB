// Mock / Real: Real is refused unless every guard passes (owner opt-in, loopback bind). Mock never needs the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { MODE_KEY, realGuards, realRefusal, modeFrom } from '../src/config.js';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings } from '../src/settings.js';
import { TENANT, connBody, mockConn, startApp, tmpDir, withMockUrl } from './helpers.js';
import { installNetguard } from './netguard.js';

const guard = installNetguard();
let s;
before(async () => { s = await startApp({ env: { [MODE_KEY]: 'mock' } }); });
after(async () => { await s.close(); assert.deepEqual(guard.attempts, [], 'zero outbound attempts'); guard.restore(); });

test('GET /api/info: Mock is the mode, Real is refused and says which guard failed', async () => {
  const r = await s.call('GET', '/api/info');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'mock'); assert.deepEqual(r.json.modes, ['mock', 'real']);
  assert.equal(r.json.real.available, false); assert.deepEqual(r.json.real.failed, ['owner-opt-in']);
  assert.ok(r.json.real.needs.length === 1 && r.json.real.needs[0].includes(MODE_KEY));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('with Real refused: a connection cannot be created and the call routes are refused before any request is made', async () => {
  const r = await s.call('POST', '/api/connections', withMockUrl(s));
  assert.equal(r.status, 403, r.text); assert.equal(r.json.error, 'real_refused'); assert.deepEqual(r.json.failed, ['owner-opt-in']);
  // A connection already in the file is refused on every network route; nothing leaves the machine.
  const c = s.app.locals.store.create(withMockUrl(s));
  for (const [m, p, b] of [
    ['POST', 'test'], ['POST', 'call', { opId: 'op-1' }], ['POST', 'settings', { allowWrites: false }], ['DELETE', ''],
  ]) {
    const res = await s.call(m, `/api/connections/${c.id}/${p}`.replace(/\/$/, ''), m === 'GET' ? undefined : (b ?? {}));
    assert.equal(res.status, 403, `${p}: ${res.text}`); assert.equal(res.json.error, 'real_refused', p);
  }
  assert.equal(s.mock.config.calls.length, 0, 'the stub saw no call');
  assert.equal((await s.call('DELETE', `/api/connections/${c.id}`)).status, 403, 'delete is also refused while Real is off (the file can be cleared by hand or Reset');
});

test('with Real refused: the spec catalog (local data) still works', async () => {
  assert.equal((await s.call('GET', '/api/spec')).status, 200);
});

test('the guards: Real needs the owner opt-in and a loopback bind (or the container opt-in)', () => {
  assert.deepEqual(realGuards({}).map((g) => [g.id, g.ok]), [['owner-opt-in', false], ['loopback-bind', true]]);
  assert.equal(realRefusal({ [MODE_KEY]: 'real' }), null);
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PAE_BIND: '0.0.0.0', PAE_CONTAINER: '1' }), null, 'the container sets both and is published on loopback only');
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PAE_BIND: '127.0.0.1' }), null, 'an explicit loopback bind is fine on a host');
  for (const bind of ['0.0.0.0', '::', '192.0.2.1']) assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PAE_BIND: bind })?.failed, ['loopback-bind'], `a host run bound to ${bind} is refused for Real`);
  assert.deepEqual(realRefusal({ [MODE_KEY]: 'real', PAE_BIND: '0.0.0.0', PAE_CONTAINER: '0' })?.failed, ['loopback-bind'], 'only the exact marker 1 counts');
  assert.deepEqual(realRefusal({ MODE: 'real' }).failed, ['owner-opt-in'], 'a bare MODE is never read');
});

test('modeFrom: mock by default, real only when asked, anything else is an error, a bare MODE is ignored', () => {
  assert.equal(modeFrom({}), 'mock'); assert.equal(modeFrom({ [MODE_KEY]: '' }), 'mock');
  assert.equal(modeFrom({ [MODE_KEY]: 'real' }), 'real');
  assert.throws(() => modeFrom({ [MODE_KEY]: 'hosted' }), /not a mode/);
  assert.equal(modeFrom({ MODE: 'real' }), 'mock');
});

test('the shared settings file: only the listed keys are taken, nothing else enters the environment, no file means defaults', () => {
  const dir = tmpDir(); const file = path.join(dir, '.env');
  fs.writeFileSync(file, `${MODE_KEY}=real\nPINGONE_ENVIRONMENT_ID=${TENANT}\nMODE=real\nPORT=1\nOTHER_APP_KEY=x\n`, { mode: 0o600 });
  assert.deepEqual(SETTINGS_KEYS.sort(), ['PRIVILEGE_EXPLORER_MODE']);
  assert.deepEqual(Object.keys(readSharedSettings(file)).sort(), SETTINGS_KEYS);
  const env = applySharedSettings({}, file);
  assert.equal(env[MODE_KEY], 'real');
  for (const k of ['PINGONE_ENVIRONMENT_ID', 'MODE', 'PORT', 'OTHER_APP_KEY']) assert.equal(env[k], undefined, k);
  assert.deepEqual(readSharedSettings(path.join(dir, 'missing')), {});
  assert.deepEqual(applySharedSettings({ STANDALONE_ENV: path.join(dir, 'missing') }), { STANDALONE_ENV: path.join(dir, 'missing') });
});

test('an unknown route and a malformed body answer JSON, never an HTML error page that echoes the path', async () => {
  const r = await s.call('GET', '/api/nothing/<script>');
  assert.equal(r.status, 404); assert.equal(r.json.error, 'not_found'); assert.ok(!r.text.includes('script'));
  const p = await s.call('POST', '/nothing/<script>', {});
  assert.equal(p.status, 404); assert.equal(p.json.error, 'not_found'); assert.ok(!p.text.includes('script'));
  const res = await fetch(`${s.origin}/api/connections`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.origin }, body: '{bad' });
  assert.equal(res.status, 400); assert.equal((await res.json()).error, 'bad_request');
});

test('a connection id is looked up as an own key: __proto__ and constructor are not connections', async () => {
  assert.equal((await s.call('POST', '/api/connections/__proto__/test')).status, 404);
  assert.equal((await s.call('POST', '/api/connections/constructor/test')).status, 404);
});

test('POST /api/mode switches the run mode; Real is a 409 with the reason while the guards fail', async () => {
  const r = await s.call('POST', '/api/mode', { source: 'real' });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'real_not_available');
  const m = await s.call('POST', '/api/mode', { source: 'mock' });
  assert.equal(m.json.source, 'mock');
  const bad = await s.call('POST', '/api/mode', { source: 'live' });
  assert.equal(bad.status, 400);
});

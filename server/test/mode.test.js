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

test('with Real refused: only a loopback-mock connection can be created; a real origin is refused before anything is stored', async () => {
  const r = await s.call('POST', '/api/connections', connBody({ url: 'https://console.example.com' }));
  assert.equal(r.status, 403, r.text); assert.equal(r.json.error, 'real_refused'); assert.deepEqual(r.json.failed, ['owner-opt-in']);
  assert.equal(s.app.locals.store.list().length, 0, 'nothing was stored');
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
  fs.writeFileSync(file, `${MODE_KEY}=real\nPINGONE_ENVIRONMENT_ID=${TENANT}\nMODE=real\nPORT=1\nOTHER_APP_KEY=x\nPRIV_EXPLORER_API_KEY=k\nPRIV_EXPLORER_API_SECRET=s\nPRIV_LOG_CONSOLE_URL=https://console.example\nPRIV_LOG_CONSOLE_TENANT=${TENANT}\nPRIV_LOG_CONSOLE_CA=\n`, { mode: 0o600 });
  assert.deepEqual(SETTINGS_KEYS.sort(), ['PRIVILEGE_EXPLORER_MODE', 'PRIV_EXPLORER_API_KEY', 'PRIV_EXPLORER_API_SECRET', 'PRIV_LOG_CONSOLE_CA', 'PRIV_LOG_CONSOLE_TENANT', 'PRIV_LOG_CONSOLE_URL'].sort());
  assert.deepEqual(Object.keys(readSharedSettings(file)).sort(), SETTINGS_KEYS.filter((k) => k !== 'PRIV_LOG_CONSOLE_CA').sort(), 'an empty value is dropped');
  const env = applySharedSettings({}, file);
  assert.equal(env[MODE_KEY], 'real');
  assert.equal(env.PRIV_EXPLORER_API_KEY, 'k');
  assert.equal(env.PRIV_EXPLORER_API_SECRET, 's');
  for (const k of ['PINGONE_ENVIRONMENT_ID', 'MODE', 'PORT', 'OTHER_APP_KEY']) assert.equal(env[k], undefined, k);
  assert.deepEqual(readSharedSettings(path.join(dir, 'missing')), {});
  assert.deepEqual(applySharedSettings({ STANDALONE_ENV: path.join(dir, 'missing') }), { STANDALONE_ENV: path.join(dir, 'missing') });
});

test('the settings preset: creates the connection from the shared settings, idempotent, secret never returned', async () => {
  const t = await startApp({ env: { PRIV_LOG_CONSOLE_URL: 'https://console.example', PRIV_LOG_CONSOLE_TENANT: TENANT, PRIV_EXPLORER_API_KEY: 'preset-key', PRIV_EXPLORER_API_SECRET: 'preset-secret-sentinel' } });
  try {
    const r = await t.call('POST', '/api/presets/settings');
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.connection.apiSecret, 'set');
    assert.ok(!r.text.includes('preset-secret-sentinel'), 'the secret never reaches the response');
    assert.equal(r.json.connection.insecureTls, undefined, 'no CA configured: the console must be a real certificate');
    const again = await t.call('POST', '/api/presets/settings');
    assert.equal(again.status, 200); assert.equal(again.json.existing, true);
    assert.equal(t.app.locals.store.list().length, 1, 'no duplicate connection');
    // a CA path flips insecureTls on
    const t2 = await startApp({ env: { PRIV_LOG_CONSOLE_URL: 'https://console.example', PRIV_LOG_CONSOLE_TENANT: TENANT, PRIV_EXPLORER_API_KEY: 'k', PRIV_EXPLORER_API_SECRET: 's', PRIV_LOG_CONSOLE_CA: '~/no-such-ca.pem' } });
    try {
      const r2 = await t2.call('POST', '/api/presets/settings');
      assert.equal(r2.json.connection.insecureTls, true);
    } finally { await t2.close(); }
  } finally { await t.close(); }
});

test('the settings preset: missing keys answer 409 with what to set; Real refused without the opt-in', async () => {
  const t = await startApp({ env: { PRIVILEGE_EXPLORER_MODE: 'real' } }); // no keys
  try {
    const r = await t.call('POST', '/api/presets/settings');
    assert.equal(r.status, 409); assert.match(r.json.message, /PRIV_EXPLORER_API_KEY/);
  } finally { await t.close(); }
  const m = await startApp({ env: { PRIVILEGE_EXPLORER_MODE: 'mock', PRIV_EXPLORER_API_KEY: 'k', PRIV_EXPLORER_API_SECRET: 's', PRIV_LOG_CONSOLE_URL: 'https://console.example', PRIV_LOG_CONSOLE_TENANT: TENANT } });
  try {
    const refused = await m.call('POST', '/api/presets/settings');
    assert.equal(refused.status, 403); assert.equal(refused.json.error, 'real_refused');
  } finally { await m.close(); }
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

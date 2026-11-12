// The runtime netguard (src/netguard.js, installed by the server when it starts): zero real outbound by default; Real holds a permit for
// each host of the saved connection in use, only while one operation on it runs. (test/netguard.js is the separate recorder the API
// tests use; this file tests the guard the shipped server runs under.)
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { installNetguard, isActive, isAllowed, netguardSelfTest, permit } from '../src/netguard.js';
import { liveHosts } from '../src/urls.js';
import { TENANT, connBody, startApp, withMockUrl } from './helpers.js';

test('self-test: every route out is refused and recorded, none reaches the network', async () => {
  const r = await netguardSelfTest();
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.blocked, 7);
  assert.match(r.detail, /fetch: blocked.*socket: blocked.*socket-ip: blocked.*dns: blocked.*dns-resolve: blocked.*udp: blocked.*udp-connect: blocked/);
  installNetguard().restore();
});

test('a real outbound attempt is blocked and appears in attempts; loopback still works', async () => {
  const g = installNetguard();
  await assert.rejects(fetch('https://example.invalid/', { signal: AbortSignal.timeout(1500) }), /network blocked/);
  await assert.rejects(new Promise((res, rej) => { const q = http.get('http://other.invalid/', res); q.on('error', rej); }), /blocked/);
  assert.ok(g.attempts.includes('fetch:example.invalid'));
  assert.ok(g.attempts.some((a) => a.includes('other.invalid')));
  g.attempts.length = 0;
  const server = http.createServer((_q, s) => s.end('ok'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(20_000) });
    assert.equal(await res.text(), 'ok');
    assert.deepEqual(g.attempts, []);
  } finally { await new Promise((r) => server.close(r)); g.restore(); }
});

test('restore puts the real functions back; raw IPs, dns.resolve* and udp are refused', async () => {
  const before = net.Socket.prototype.connect;
  const g = installNetguard();
  assert.notEqual(net.Socket.prototype.connect, before); assert.equal(isActive(), true);
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 80 }), /network blocked: 192\.0\.2\.1/);
  await assert.rejects(dns.promises.resolve4('probe.invalid'), /network blocked/);
  const s = dgram.createSocket('udp4');
  try { assert.throws(() => s.send('127.0.0.1', 9, 'evil.invalid'), /network blocked: evil\.invalid/); } finally { s.close(); }
  g.restore();
  assert.equal(net.Socket.prototype.connect, before); assert.equal(isActive(), false);
});

test('a connected UDP socket cannot reach a non-loopback peer: connect() is refused and recorded, loopback still connects', async () => {
  const g = installNetguard();
  const s = dgram.createSocket('udp4');
  try {
    assert.throws(() => s.connect(9, '192.0.2.1'), /network blocked: 192\.0\.2\.1/);
    assert.throws(() => s.connect(9, 'peer.invalid'), /network blocked: peer\.invalid/);
    // A later send(msg) with no address would go to the connected peer; the socket never got one.
    assert.throws(() => s.remoteAddress(), (e) => e.code === 'ERR_SOCKET_DGRAM_NOT_CONNECTED');
    assert.deepEqual(g.attempts, ['udp:192.0.2.1', 'udp:peer.invalid']);
    s.close();
    g.attempts.length = 0;
    const l = dgram.createSocket('udp4');
    await new Promise((res, rej) => { l.once('error', rej); l.connect(9, '127.0.0.1', res); });
    l.close();
    assert.deepEqual(g.attempts, [], 'loopback needs no permit');
  } finally { try { s.close(); } catch { /* already closed */ } g.restore(); }
});

test('a permit allows exactly one named host, only while held; loopback never needs one; overlapping permits are counted', () => {
  assert.equal(isAllowed('127.0.0.1'), true); assert.equal(isAllowed('real.example'), false);
  const release = permit('Real.Example');
  assert.equal(isAllowed('real.example'), true, 'case-insensitive'); assert.equal(isAllowed('other.example'), false, 'only the named host');
  release(); release();
  assert.equal(isAllowed('real.example'), false);
  const a = permit('real.example'); const b = permit('real.example');
  a(); assert.equal(isAllowed('real.example'), true); b(); assert.equal(isAllowed('real.example'), false);
});

test('liveHosts: the one console origin the connection names', () => {
  assert.deepEqual(liveHosts({ url: 'https://console.example.com' }), ['console.example.com']);
  assert.deepEqual(liveHosts({ url: 'http://127.0.0.1:8643' }), ['127.0.0.1']);
  assert.deepEqual(liveHosts(null), []);
});

test('Real holds a permit for the connection\'s console host while an operation runs, and gives it back; Mock holds none', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const host = new URL(url).hostname;
    if (host === '127.0.0.1') return fetch(url, init); // the in-process mock, on loopback: the real fetch, under the guard
    seen.push({ host, target: isAllowed(host), stranger: isAllowed('stranger.example') });
    return new Response(JSON.stringify({ note: 'stub' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const guard = installNetguard();
  const s = await startApp({ fetchImpl });
  try {
    const c = (await s.call('POST', '/api/connections', connBody({ url: 'https://console.example.com', apiKey: 'k', apiSecret: 'sentinel-secret-1' }))).json;
    const spec = (await s.call('GET', '/api/spec?q=users&method=get')).json;
    const usersOp = spec.operations.find((o) => o.path === '/api/{ObjectMeta.Tenant}/v1/users');
    assert.equal((await s.call('POST', `/api/connections/${c.id}/call`, { opId: usersOp.id, values: {} })).json.status, 200);
    assert.deepEqual([...new Set(seen.map((x) => x.host))], ['console.example.com']);
    for (const x of seen) { assert.equal(x.target, true, `${x.host} is permitted while its operation runs`); assert.equal(x.stranger, false, 'no other host is'); }
    assert.equal(isAllowed('console.example.com'), false, 'released afterwards');
    assert.ok(!JSON.stringify(seen).includes('sentinel-secret-1'));
    // Mock: nothing permitted, and a whole mock session leaves no attempt.
    seen.length = 0;
    const m = (await s.call('POST', '/api/connections', withMockUrl(s))).json;
    assert.equal((await s.call('POST', `/api/connections/${m.id}/test`)).json.ok, true);
    assert.equal(seen.length, 0, 'the mock reaches only loopback: no host is ever permitted for it');
    assert.deepEqual(guard.attempts, [], 'zero outbound attempts');
  } finally { await s.close(); guard.restore(); }
});

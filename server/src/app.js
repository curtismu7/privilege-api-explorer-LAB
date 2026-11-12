import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { buildRequest, createClient, CLASS_BY_METHOD } from './client.js';
import { MODES, MODE_KEY, dataDir as cfgDataDir, realRefusal, modeFrom, webDist } from './config.js';
import catalog from './spec-catalog.json' with { type: 'json' };
import { createDiagrams, DIAGRAM_DIR } from './diagrams.js';
import { createHealth } from './health.js';
import { createMock } from './mock.js';
import { permit } from './netguard.js';
import { clip, scrub, scrubJson } from './redact.js';
import { hostCheck, isLoopbackHost, labAllowedHosts, sameOriginWrites } from './security.js';
import { createStore } from './store.js';
import { liveHosts } from './urls.js';
import { shelfInfo } from './shelfLink.js';

// ReDoS-safe search: plain substring match on lowercased strings, no user regex.
const HAY = (o) => `${o.method} ${o.path} ${o.tag} ${o.summary} ${o.opId || ''}`.toLowerCase();
const OPS = catalog.operations.map((o, i) => ({ id: `op-${i + 1}`, ...o, klass: CLASS_BY_METHOD[o.method] || 'write' }));
const OPS_BY_ID = new Map(OPS.map((o) => [o.id, o]));

export function createApp({ env = process.env, lab = labAllowedHosts(env), store, mock, now = Date.now, fetchImpl = fetch, diagramsDir = DIAGRAM_DIR } = {}) {
  const diagrams = createDiagrams({ dir: diagramsDir }); // diagram-studio/1 data, validated now: an invalid file stops the app from starting
  const dir = cfgDataDir(env);
  store ||= createStore({ dir });
  const audit = createAudit({ dir });
  const theMock = mock || createMock();
  let mockStarted = Boolean(mock?.base);
  const ensureMock = async () => { if (!mockStarted) { await theMock.start(); mockStarted = true; } };
  const callPrivilege = createClient({ fetchImpl });
  const health = createHealth({ store, env });
  // Real is refused unless every guard in config.js passes. A saved connection is always Real.
  const realGate = realRefusal(env);
  const refuseReal = (res) => res.status(403).json({ error: 'real_refused', message: `Real is refused: ${realGate.failed.join(', ')}. ${realGate.needs.join(' ')}`, failed: realGate.failed, needs: realGate.needs });
  // A short-lived permit for the connection's console host, held while one operation on it runs (see netguard.js).
  async function withPermits(conn, fn) {
    const releases = liveHosts(conn).map((host) => permit(host));
    try { return await fn(); } catch (err) {
      if (conn.insecureTls && err?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') err.message = 'the console certificate is not trusted: enable "self-signed certificate" on the connection';
      throw err;
    } finally { for (const r of releases) r(); }
  }

  const secretsFor = (conn) => store.secretsOf(conn);
  const view = (c) => store.publicView(c);

  function fail(res, conn, err) {
    const secrets = conn ? secretsFor(conn) : [];
    const message = scrub(err?.message || 'error', secrets).slice(0, 300);
    const code = err?.code || 'internal_error';
    const status = code === 'login_required' ? 401 : code === 'writes_disabled' ? 403 : code === 'bad_request' ? 400 : err?.cause?.code === 'ENOTFOUND' || err?.cause?.code === 'ECONNREFUSED' ? 502 : 500;
    const body = { error: String(code), message: status === 500 && !err?.code ? 'internal error' : message };
    if (err?.httpStatus) body.upstreamStatus = err.httpStatus;
    return res.status(status).json(body);
  }

  // History: every call, real or mock, in memory and on disk (mode 600 file, redacted).
  function createAudit({ dir: d }) {
    const file = path.join(d, 'audit.jsonl');
    const recent = [];
    try { for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(-500)) { if (!line.trim()) continue; try { recent.push(JSON.parse(line)); } catch { /* skip */ } } } catch { /* none yet */ }
    const persist = (e) => { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.appendFileSync(file, `${JSON.stringify(e)}\n`, { mode: 0o600 }); } catch { /* best effort */ } };
    return {
      recent: () => recent.slice(-200).reverse(),
      record(e) { const full = { ...e, at: new Date(now()).toISOString() }; recent.push(full); if (recent.length > 500) recent.splice(0, recent.length - 500); persist(full); },
      clear() { recent.length = 0; try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } },
    };
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck(env));
  app.use(sameOriginWrites(lab));
  app.use(express.json({ limit: '200kb' }));
  app.use('/api/health', health.router);

  const h = (fn) => async (req, res) => {
    const conn = req.params.id ? store.get(req.params.id) : null;
    if (req.params.id && !conn) return res.status(404).json({ error: 'not_found', message: 'no such connection' });
    if (conn && realGate) return refuseReal(res);
    try {
      await withPermits(conn, () => fn(req, res, conn));
    } catch (err) { fail(res, conn, err); }
  };

  // ---- mode: what the header toggle may do. Rule 19: the server-side Mock/Real mode. POST /api/mode switches for
  // this run. Real is only available when every Real guard passes.
  let runMode = modeFrom(env); // 'mock' | 'real'
  const modeView = () => ({
    source: runMode === 'real' ? 'real' : 'mock',
    realAvailable: !realGate,
    realReason: realGate ? `Real is refused: ${realGate.failed.join(', ')}. ${realGate.needs.join(' ')}` : null,
  });
  app.post('/api/mode', (req, res) => {
    const source = req.body?.source;
    if (source !== 'mock' && source !== 'real') return res.status(400).json({ error: 'bad_request', message: 'source must be exactly "mock" or "real"' });
    if (source === 'real' && realGate) return res.status(409).json({ error: 'real_not_available', message: modeView().realReason });
    runMode = source === 'real' ? 'real' : 'mock';
    res.json(modeView());
  });
  app.get('/api/info', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ mode: runMode, ...modeView(), modes: [...MODES], key: MODE_KEY, requested: modeFrom(env), real: { available: !realGate, failed: realGate?.failed ?? [], needs: realGate?.needs ?? [] } });
  });

  // Reset: run state goes back to the start (audit history, the mock's fake tenant, writes off). Saved connections
  // and their secrets are kept. The page also puts the diagram boxes back.
  app.post('/api/reset', (_req, res) => {
    audit.clear(); const writesOff = store.resetWrites();
    if (mockStarted) theMock.reset();
    health.refresh();
    res.json({ ok: true, cleared: ['audit history', 'mock tenant'], writesTurnedOff: writesOff, kept: ['connections'] });
  });

  // ---- diagrams: diagram-studio/1 data served by name from a fixed allow-list. An unknown name is a JSON 404 that does not echo the input.
  app.get('/api/diagrams', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ diagrams: diagrams.list() }); });
  app.get('/api/diagrams/:name', (req, res) => {
    const doc = diagrams.get(req.params.name);
    if (!doc) return res.status(404).json({ error: 'unknown_diagram', message: 'No such diagram.' });
    res.set('Cache-Control', 'no-store');
    return res.json(doc);
  });

  // ---- connections
  app.get('/api/connections', (_req, res) => res.json({ connections: store.list().map(view) }));
  app.post('/api/connections', (req, res) => {
    if (realGate) return refuseReal(res);
    try { const c = store.create(req.body || {}); health.refresh(); res.status(201).json(view(c)); }
    catch (err) { res.status(400).json({ error: 'bad_request', message: scrub(err.message, [req.body?.apiSecret]) }); }
  });
  app.delete('/api/connections/:id', h((_req, res, conn) => { store.remove(conn.id); health.refresh(); res.json({ ok: true }); }));
  app.post('/api/connections/:id/settings', h((req, res, conn) => res.json(view(store.update(conn.id, { allowWrites: req.body?.allowWrites })))));

  // Connection check: one cheap real GET against the console to prove the credential works.
  app.post('/api/connections/:id/test', h(async (_req, res, conn) => {
    const probe = OPS.find((o) => o.method === 'GET' && o.path === '/api/{ObjectMeta.Tenant}/v1/users') || OPS.find((o) => o.method === 'GET');
    try {
      const built = buildRequest(probe, {}, { tenant: conn.tenant });
      const t0 = Date.now();
      const out = await callPrivilege(conn, { method: 'GET', path: built.path });
      audit.record({ conn: view(conn), op: 'connection-test', outcome: 'ok', status: out.status, ms: Date.now() - t0 });
      res.json({ ok: true, status: out.status, ms: Date.now() - t0, probed: built.path });
    } catch (err) {
      const ok = false;
      const message = err.code === 'login_required' ? err.message : scrub(err.message || 'error', secretsFor(conn)).slice(0, 300);
      audit.record({ conn: view(conn), op: 'connection-test', outcome: err.code === 'login_required' ? 'refused' : 'error', status: err.httpStatus, note: err.code });
      res.json({ ok, error: String(err.code || 'error'), message });
    }
  }));

  // ---- the API catalog: full swagger surface, searchable
  app.get('/api/spec', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 120);
    const tag = String(req.query.tag ?? '').trim().slice(0, 80);
    const method = String(req.query.method ?? '').trim().toUpperCase();
    let ops = OPS;
    if (tag) ops = ops.filter((o) => o.tag === tag);
    if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) ops = ops.filter((o) => o.method === method);
    // Substring search across method, path, tag, summary, operationId. "pi" matches every /api/... path (they all
    // start with "get /api/"), so a bare common term is not useful on its own — the UI hints that; tag/method filters
    // narrow it. Substring, not prefix: "users" matches listUsers too.
    if (q) ops = ops.filter((o) => HAY(o).includes(q));
    const tags = [...new Set(OPS.map((o) => o.tag))].sort((a, b) => a.localeCompare(b));
    const byMethod = {};
    for (const o of ops) byMethod[o.method] = (byMethod[o.method] || 0) + 1;
    res.json({ total: OPS.length, matched: ops.length, byMethod, tags, operations: ops.map((o) => ({ ...o, summary: clip(o.summary, 160) })) });
  });
  app.get('/api/spec/ops/:id', (req, res) => {
    const op = OPS_BY_ID.get(String(req.params.id));
    if (!op) return res.status(404).json({ error: 'unknown_operation', message: 'No such operation in the catalog.' });
    res.set('Cache-Control', 'no-store');
    res.json(op);
  });

  // ---- the call proxy: one operation against one connection, real or mock. Read-only by default; writes gated.
  app.post('/api/connections/:id/call', h(async (req, res, conn) => {
    const { opId, values, body } = req.body || {};
    const op = OPS_BY_ID.get(String(opId || ''));
    if (!op) { audit.record({ conn: view(conn), op: String(opId || '').slice(0, 60), outcome: 'blocked:unknown_operation' }); return res.status(400).json({ error: 'bad_request', message: 'opId must name a catalog operation' }); }
    let built;
    try { built = buildRequest(op, values && typeof values === 'object' ? values : {}, { tenant: conn.tenant }); }
    catch (err) { audit.record({ conn: view(conn), op: op.opId, outcome: `blocked:${err.code || 'bad_request'}`, note: err.message }); return res.status(400).json({ error: 'bad_request', message: err.message }); }
    const t0 = Date.now();
    try {
      const out = await callPrivilege(conn, { method: op.method, path: built.path, body: op.method === 'GET' || op.method === 'DELETE' ? undefined : (body ?? {}) });
      const ms = Date.now() - t0;
      audit.record({ conn: view(conn), op: op.opId, path: built.path, outcome: out.status < 400 ? 'ok' : `upstream:${out.status}`, status: out.status, ms });
      res.status(200).json({ status: out.status, ms, path: built.path, sessionId: out.sessionId, body: scrubJson(out.body, secretsFor(conn)) });
    } catch (err) {
      const ms = Date.now() - t0;
      audit.record({ conn: view(conn), op: op.opId, path: built.path, outcome: err.code === 'login_required' ? 'refused' : 'error', status: err.httpStatus, ms, note: err.code });
      throw err;
    }
  }));

  // ---- audit + mock call log (evidence for the UI)
  app.get('/api/audit', (_req, res) => res.json({ entries: audit.recent() }));
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button

  if (fs.existsSync(webDist)) { app.use(express.static(webDist)); app.get('*', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile('index.html', { root: webDist }))); }
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'request too large' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'bad_request', message: 'invalid JSON' });
    if (err instanceof URIError) return res.status(400).json({ error: 'bad_request', message: 'bad address' }); // a malformed %-escape in a path (Express reports it as a URIError)
    return res.status(500).json({ error: 'internal_error', message: 'internal error' });
  });

  app.locals.store = store; app.locals.audit = audit; app.locals.mock = theMock;
  app.locals.close = async () => { health.stop(); if (!mock && mockStarted) await theMock.stop(); };
  return app;
}

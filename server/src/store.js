// Saved Privilege connections. Adapted from the family store pattern (MIT, same author): atomic write, file mode 600
// in a mode 700 dir. The API secret is held here and never returned: publicView() shows 'set'. A connection is one
// Privilege console API base (host + tenant id) plus its credential pair.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPrivateLiteral } from './urls.js';
import { isLoopbackHost } from './security.js';

const TENANT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('url is not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('url must be http or https');
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname)) throw new Error('url must be https (http is allowed only for a loopback address)');
  if (isPrivateLiteral(u.hostname)) throw new Error('url must not be a private or link-local address');
  if (u.username || u.password) throw new Error('put credentials in the key/secret fields, not in the URL');
  if (u.pathname && u.pathname !== '/' && u.pathname !== '/') throw new Error('url must be the console origin only (no path)');
  return u.origin;
}
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export function createStore({ dir }) {
  const file = path.join(dir, 'connections.json');
  function load() {
    try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
  }
  function save(all) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  }

  function create(b) {
    if (b.kind !== 'privilege') throw new Error('kind must be "privilege"');
    const rec = { id: crypto.randomUUID(), kind: 'privilege', label: str(b.label, 80) || 'Privilege console', createdAt: new Date().toISOString(), allowWrites: false };
    rec.url = cleanUrl(b.url);
    rec.tenant = str(b.tenant, 64);
    if (!TENANT_RE.test(rec.tenant)) throw new Error('tenant must be your Privilege tenant id (a UUID)');
    rec.apiKey = str(b.apiKey, 200);
    if (!rec.apiKey) throw new Error('apiKey is required');
    rec.apiSecret = str(b.apiSecret, 500);
    if (!rec.apiSecret) throw new Error('apiSecret is required');
    if (b.insecureTls === true) rec.insecureTls = true; // self-signed local console cert; never the default
    const all = load(); all[rec.id] = rec; save(all);
    return rec;
  }

  const get = (id) => { const all = load(); return typeof id === 'string' && Object.hasOwn(all, id) ? all[id] : null; };
  const list = () => Object.values(load());
  function update(id, patch) {
    const all = load(); const rec = Object.hasOwn(all, id) ? all[id] : null;
    if (!rec) return null;
    if (typeof patch.allowWrites === 'boolean') rec.allowWrites = patch.allowWrites;
    save(all); return rec;
  }
  // Reset: every connection goes back to writes off (the safe state). Saved connections and their secrets are kept.
  function resetWrites() { const all = load(); let n = 0; for (const rec of Object.values(all)) if (rec.allowWrites) { rec.allowWrites = false; n++; } if (n) save(all); return n; }
  function remove(id) { const all = load(); if (!Object.hasOwn(all, id)) return false; delete all[id]; save(all); return true; }

  function publicView(rec) {
    const { apiSecret, ...rest } = rec;
    return { ...rest, apiSecret: rec.apiSecret ? 'set' : null };
  }
  function secretsOf(rec) {
    return [rec?.apiSecret, rec?.apiKey].filter(Boolean);
  }
  return { create, get, list, update, remove, resetWrites, publicView, secretsOf, file };
}

// The one Privilege console call path. Every Real API request goes through here: the key/secret header scheme
// (x-api-key / x-api-secret, plus the required x-procyon-session-id correlation UUID — its value is unvalidated by the
// console). A failed login (401/403) surfaces as login_required so the UI asks for the credential again. Reads only;
// a write is refused unless the connection has allowWrites AND the method is in the safe-write set.
import crypto from 'node:crypto';

const SAFE_WRITE_METHODS = new Set(['POST', 'PUT']);
export const CLASS_BY_METHOD = { GET: 'read', POST: 'write', PUT: 'write', DELETE: 'destructive', PATCH: 'write' };

// Fill path + query parameters from typed values. Path params are substituted; everything else becomes a query string.
// The tenant path parameter is filled from the connection automatically. Values are encoded; the path is built from
// the spec's own path template, never from raw user text.
export function buildRequest(op, values = {}, { tenant } = {}) {
  const out = { query: {} };
  let path = op.path;
  for (const p of op.params) {
    const raw = p.name === 'ObjectMeta.Tenant' ? (tenant ?? values[p.name]) : values[p.name];
    if (raw === undefined || raw === '') continue;
    const v = encodeURIComponent(String(raw));
    if (p.in === 'path') {
      if (!path.includes(`{${p.name}}`)) throw new Error(`parameter "${p.name}" is not in this operation's path template`);
      path = path.split(`{${p.name}}`).join(v);
    } else out.query[p.name] = v;
  }
  for (const p of op.params) {
    if (p.in === 'path' && path.includes(`{${p.name}}`)) throw new Error(`required path parameter "${p.name}" is missing`);
    if (p.in === 'body') continue; // the body is passed separately by the caller
    if (p.required && p.in !== 'path' && !(p.name in out.query) && p.name !== 'ObjectMeta.Tenant') throw new Error(`required parameter "${p.name}" is missing`);
  }
  out.path = path + (Object.keys(out.query).length ? `?${new URLSearchParams(out.query).toString()}` : '');
  return out;
}

export function createClient({ fetchImpl = fetch } = {}) {
  return async function callPrivilege(conn, { method, path, body }) {
    if (method !== 'GET' && !SAFE_WRITE_METHODS.has(method) && !conn.allowWrites) {
      const e = new Error('writes are off for this connection: enable them in the connection settings before a destructive or write call');
      e.code = 'writes_disabled'; throw e;
    }
    const sessionId = crypto.randomUUID();
    const headers = {
      'x-api-key': conn.apiKey,
      'x-api-secret': conn.apiSecret,
      'x-procyon-session-id': sessionId,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(`${conn.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      // The local desktop console's cert is self-signed; only an explicit per-connection opt-in allows it. Node's
      // fetch has no per-request CA escape hatch, so the opt-in goes through an undici dispatcher when set.
      ...(conn.insecureTls ? { dispatcher: insecureDispatcher() } : {}),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON: keep the text */ }
    if (res.status === 401 || res.status === 403) {
      const e = new Error(`the console refused the credential (HTTP ${res.status}): check the API key and secret`);
      e.code = 'login_required'; e.httpStatus = res.status; e.upstreamBody = text.slice(0, 500);
      throw e;
    }
    return { status: res.status, body: json ?? text, sessionId, contentType: res.headers.get('content-type') || '' };
  };
}

let dispatcherPromise = null;
function insecureDispatcher() {
  // Lazy: undici is a built-in dependency of Node's fetch; importing it eagerly is harmless but slow at boot.
  dispatcherPromise ||= import('undici').then(({ Agent }) => new Agent({ connect: { rejectUnauthorized: false } }));
  return dispatcherPromise;
}

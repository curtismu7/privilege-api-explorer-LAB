// The one Privilege console call path. Every Real API request goes through here: the key/secret header scheme
// (x-api-key / x-api-secret, plus the required x-procyon-session-id correlation UUID — its value is unvalidated by the
// console). A failed login (401/403) surfaces as login_required so the UI asks for the credential again. Reads only;
// a write is refused unless the connection has allowWrites AND the method is in the safe-write set.
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';

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

// One request over node:https/node:http (fetch cannot do per-request TLS options, and the local desktop console's
// self-signed cert needs rejectUnauthorized:false for the connections that opt in). Returns { status, body, headers }.
function send({ url, method, headers, body, insecure, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method,
      headers,
      // Only an explicit per-connection opt-in allows the self-signed local console certificate.
      ...(u.protocol === 'https:' ? { rejectUnauthorized: !insecure } : {}),
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; if (text.length > 4_000_000) req.destroy(new Error('response too large')); });
      res.on('end', () => resolve({ status: res.statusCode, text, contentType: res.headers['content-type'] || '' }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('the console did not answer in time'), { code: 'timeout' })));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function createClient({ fetchImpl = fetch } = {}) {
  // fetchImpl kept for signature compatibility with tests that stub it; the insecure path always uses node:https.
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
    const url = `${conn.url}${path}`;
    let out;
    if (conn.insecureTls) {
      out = await send({ url, method, headers, body: body === undefined ? undefined : JSON.stringify(body), insecure: true });
    } else {
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        if (String(err?.cause?.code || err?.cause?.message || '').includes('SELF_SIGNED')) {
          const e = new Error('the console certificate is not trusted: enable "self-signed certificate" on the connection');
          e.code = 'tls_untrusted'; throw e;
        }
        throw err;
      }
      out = { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') || '' };
    }
    let json = null; try { json = JSON.parse(out.text); } catch { /* not JSON: keep the text */ }
    if (out.status === 401 || out.status === 403) {
      const e = new Error(`the console refused the credential (HTTP ${out.status}): check the API key and secret`);
      e.code = 'login_required'; e.httpStatus = out.status; e.upstreamBody = out.text.slice(0, 500);
      throw e;
    }
    return { status: out.status, body: json ?? out.text, sessionId, contentType: out.contentType };
  };
}

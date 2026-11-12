import React, { useMemo, useState } from "react";
import * as api from "../api.js";
import { Untrusted } from "../lib/Untrusted.jsx";
import { classOf, pretty } from "../lib/format.js";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const CLASS_LABEL = { read: "read", write: "write", destructive: "destructive" };

function MethodBadge({ m }) {
  return <span className={`badge badge--${classOf({ method: m })}`} data-testid={`method-${m}`}>{m}</span>;
}

function OpCard({ op, onOpen }) {
  return (
    <li className="card op-card" data-testid="op-card">
      <div className="row between">
        <h3><MethodBadge m={op.method} /> <Untrusted text={op.path} /></h3>
        <button type="button" onClick={() => onOpen(op.id)}>Open</button>
      </div>
      {op.summary ? <p className="meta"><Untrusted text={op.summary} /></p> : null}
      <p className="meta">Service: <Untrusted text={op.tag} /></p>
    </li>
  );
}

// The parameter form: one field per spec parameter (path and query); the tenant is prefilled from the connection.
function Fields({ op, values, setValues }) {
  const params = op.params.filter((p) => p.in !== "body");
  if (!params.length) return <p>This operation takes no path or query parameters.</p>;
  return params.map((p) => {
    const req = p.required || p.name === "ObjectMeta.Tenant";
    const label = <>{p.name} <small>({p.in}){req && <abbr title="filled automatically from the connection"> tenant</abbr>}{p.required && p.name !== "ObjectMeta.Tenant" && <abbr title="required"> *</abbr>}</small></>;
    return (
      <label className="field" key={p.name}>
        {label}
        <input
          value={values[p.name] ?? ""}
          onChange={(e) => setValues((v) => { const n = { ...v }; if (e.target.value === "") delete n[p.name]; else n[p.name] = e.target.value; return n; })}
          spellCheck="false"
          autoComplete="off"
          data-testid={`param-${p.name}`}
        />
      </label>
    );
  });
}

// The result pane: status, timing, the exact path that was called, and the raw body.
export function Result({ result }) {
  if (!result) return null;
  const st = result.pending ? "pending" : result.error ? "bad" : result.status < 400 ? "ok" : "warn";
  return (
    <section className="card" aria-labelledby="res-h" data-testid="result">
      <h2 id="res-h">Result</h2>
      {result.pending && <p role="status">Calling…</p>}
      {!result.pending && result.error && <p className="err-text" role="alert" data-testid="result-error">{result.error}: {result.message}</p>}
      {!result.pending && !result.error && (
        <>
          <dl className="kv">
            <dt>HTTP status</dt><dd><strong data-testid="result-status" data-state={st}>{result.status}</strong></dd>
            <dt>Elapsed</dt><dd data-testid="result-ms">{result.ms} ms</dd>
            <dt>Path called</dt><dd><code data-testid="result-path"><Untrusted text={result.path} /></code></dd>
            <dt>Session id</dt><dd><code><Untrusted text={result.sessionId} /></code></dd>
          </dl>
          <pre data-testid="result-body"><Untrusted text={pretty(result.body)} /></pre>
        </>
      )}
    </section>
  );
}

export default function Explorer({ conn }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [method, setMethod] = useState("");
  const [data, setData] = useState(null); // { total, matched, byMethod, tags, operations }
  const [open, setOpen] = useState(null); // the full operation
  const [values, setValues] = useState({});
  const [body, setBody] = useState("{}");
  const [bodyErr, setBodyErr] = useState("");
  const [result, setResult] = useState(null);
  const [collapsed, setCollapsed] = useState({}); // tag -> true when its category is folded

  const load = React.useCallback(async (params) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.tag) sp.set("tag", params.tag);
    if (params.method) sp.set("method", params.method);
    const r = await api.get(`/api/spec?${sp.toString()}`);
    if (r.ok) setData(r.json);
  }, []);
  React.useEffect(() => { load({ q, tag, method }); }, [q, tag, method, load]);

  // Idle view (no search, no filters): all operations, grouped by service like the swagger UI's tag sections.
  // Any search or filter switches to the flat match list.
  const grouped = React.useMemo(() => {
    if (!data || q || tag || method) return null;
    const map = new Map();
    for (const o of data.operations) {
      if (!map.has(o.tag)) map.set(o.tag, []);
      map.get(o.tag).push(o);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, q, tag, method]);

  async function openOp(id) {
    const r = await api.get(`/api/spec/ops/${id}`);
    if (!r.ok) return;
    setOpen(r.json);
    setValues((v) => ({ ...v, "ObjectMeta.Tenant": conn?.tenant ?? v["ObjectMeta.Tenant"] ?? "" }));
    setResult(null);
  }

  async function call() {
    if (!conn) return;
    let parsed;
    try { parsed = JSON.parse(body); setBodyErr(""); } catch { setBodyErr("The request body is not valid JSON."); return; }
    setResult({ pending: true });
    const r = await api.post(`/api/connections/${conn.id}/call`, { opId: open.id, values, body: parsed });
    if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 500 || r.status === 502) {
      setResult({ error: r.json?.error || "error", message: r.json?.message || `HTTP ${r.status}` });
      return;
    }
    setResult(r.json);
  }

  if (!conn) {
    return <><h1>Explorer</h1><p>Select a connection first: the explorer calls the console it names.</p></>;
  }
  const matched = data?.matched ?? "…";
  const total = data?.total ?? "…";
  return (
    <>
      <h1>Explorer</h1>
      <p className="lede">All {total} operations from the Privilege console's swagger. Search is a substring match across method, path, service and summary — type <code>pi</code> to see every <code>pi*</code> path, <code>pacpolicys</code> for one collection. Narrow with a service or a method.</p>
      <section className="card" aria-labelledby="search-h">
        <h2 id="search-h">Find an operation</h2>
        <label className="field">Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. pi, users, agentaccesskeys" data-testid="search" spellCheck="false" />
        </label>
        <div className="grid2">
          <label className="field">Service
            <select value={tag} onChange={(e) => setTag(e.target.value)} data-testid="tag-filter">
              <option value="">All services</option>
              {(data?.tags ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="method-filter">
              <option value="">All methods</option>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <p className="meta" data-testid="match-count">{grouped ? `All ${total} operations, by service.` : `${matched} of ${total} operations match.`}</p>
        {grouped ? (
          grouped.map(([svc, ops]) => (
            <section className="op-group" key={svc} data-testid="op-group">
              <h3 className="op-group-h">
                <button type="button" className="linkish" onClick={() => setCollapsed((c) => ({ ...c, [svc]: !c[svc] }))} aria-expanded={!collapsed[svc]} data-testid="op-group-toggle">
                  {collapsed[svc] ? "▸" : "▾"} <Untrusted text={svc} />
                </button>
                <span className="meta"> {ops.length}</span>
              </h3>
              {!collapsed[svc] && (
                <ul className="plain">
                  {ops.map((o) => <OpCard key={o.id} op={o} onOpen={openOp} />)}
                </ul>
              )}
            </section>
          ))
        ) : (
          <ul className="plain">
            {(data?.operations ?? []).map((o) => <OpCard key={o.id} op={o} onOpen={openOp} />)}
          </ul>
        )}
      </section>
      {open && (
        <section className="card" aria-labelledby="op-h" data-testid="op-detail">
          <h2 id="op-h"><MethodBadge m={open.method} /> <Untrusted text={open.path} /></h2>
          <p className="meta">Service: <Untrusted text={open.tag} />{open.summary ? <> — <Untrusted text={open.summary} /></> : null}</p>
          <Fields op={open} values={values} setValues={setValues} />
          {open.method !== "GET" && open.method !== "DELETE" && (
            <label className="field">Request body (JSON)
              <textarea rows={4} value={body} onChange={(e) => { setBody(e.target.value); setBodyErr(""); }} spellCheck="false" data-testid="body" />
            </label>
          )}
          {bodyErr && <p className="err-text" role="alert">{bodyErr}</p>}
          <div className="row wrap">
            <button type="button" className="primary" onClick={call} data-testid="call">Call {open.method} now</button>
            <button type="button" onClick={() => { setOpen(null); setResult(null); }}>Close</button>
          </div>
          <p className="hint">{open.method === "GET" ? "A read: runs whenever the connection exists." : open.method === "DELETE" ? "Destructive: runs only when writes are enabled on the connection." : "A write: runs only when writes are enabled on the connection."}</p>
        </section>
      )}
      <Result result={result} />
    </>
  );
}

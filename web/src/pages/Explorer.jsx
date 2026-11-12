import React, { useMemo, useState } from "react";
import * as api from "../api.js";
import { Untrusted } from "../lib/Untrusted.jsx";
import { classOf, pretty } from "../lib/format.js";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

function MethodBadge({ m }) {
  return <span className={`badge badge--${classOf({ method: m })}`} data-testid={`method-${m}`}>{m}</span>;
}

// The result pane: status, timing, the exact path that was called, and the raw body. It renders wherever the
// caller puts it — inside the operation card (inline runner) or once at the bottom (kept for tests/other pages).
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

// One operation row: collapsed shows method, path and summary; expanding reveals the parameter fields, the body
// editor, the Run button and the result — all inside the card, so nothing ever sends the user far down the page.
// `busy` names the operation currently running so two cards cannot both show a spinner.
function OpCard({ op, values, setValues, body, setBody, bodyErr, setBodyErr, busy, run, expanded, onToggle }) {
  const running = busy === op.id;
  const result = op._result; // set by run() on the parent's state object
  return (
    <li className={`card op-card${expanded ? " op-card--open" : ""}`} data-testid="op-card">
      <div className="row between">
        <button type="button" className="op-card__summary" onClick={onToggle} aria-expanded={expanded} data-testid="op-toggle">
          <MethodBadge m={op.method} /> <code><Untrusted text={op.path} /></code>
        </button>
        <button type="button" className={expanded ? undefined : "primary"} onClick={onToggle} data-testid="op-open">
          {expanded ? "Close" : "Run…"}
        </button>
      </div>
      {op.summary && !expanded ? <p className="meta"><Untrusted text={op.summary} /></p> : null}
      {expanded && (
        <div className="op-card__runner" data-testid="op-runner">
          <p className="meta">Service: <Untrusted text={op.tag} />{op.summary ? <> — <Untrusted text={op.summary} /></> : null}</p>
          {op.params.filter((p) => p.in !== "body").length === 0 ? null : op.params.filter((p) => p.in !== "body").map((p) => {
            const req = p.required || p.name === "ObjectMeta.Tenant";
            return (
              <label className="field" key={p.name}>
                {p.name} <small>({p.in}){req && <abbr title="filled automatically from the connection"> tenant</abbr>}{p.required && p.name !== "ObjectMeta.Tenant" && <abbr title="required"> *</abbr>}</small>
                <input
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues((v) => { const n = { ...v }; if (e.target.value === "") delete n[p.name]; else n[p.name] = e.target.value; return n; })}
                  spellCheck="false"
                  autoComplete="off"
                  data-testid={`param-${p.name}`}
                />
              </label>
            );
          })}
          {op.method !== "GET" && op.method !== "DELETE" && (
            <label className="field">Request body (JSON)
              <textarea rows={4} value={body} onChange={(e) => { setBody(e.target.value); setBodyErr(""); }} spellCheck="false" data-testid="body" />
            </label>
          )}
          {bodyErr && <p className="err-text" role="alert">{bodyErr}</p>}
          <div className="row wrap">
            <button type="button" className="primary" onClick={() => run(op)} disabled={running} data-testid="call">{running ? "Calling…" : `Run ${op.method}`}</button>
          </div>
          <p className="hint">{op.method === "GET" ? "A read: runs whenever the connection exists." : op.method === "DELETE" ? "Destructive: runs only when writes are enabled on the connection." : "A write: runs only when writes are enabled on the connection."}</p>
          {result && <Result result={result} />}
        </div>
      )}
    </li>
  );
}

export default function Explorer({ conn }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [method, setMethod] = useState("");
  const [data, setData] = useState(null); // { total, matched, byMethod, tags, operations }
  const [values, setValues] = useState({});
  const [body, setBody] = useState("{}");
  const [bodyErr, setBodyErr] = useState("");
  const [busy, setBusy] = useState(null); // the op id currently running
  const [results, setResults] = useState({}); // op id -> last result (kept per card)
  const [openId, setOpenId] = useState(null); // the expanded card
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

  // The card's runner takes its parameter set from the operation the card opens (full spec record, params included).
  const [ops, setOps] = useState({}); // op id -> the full operation record from /api/spec/ops/:id
  async function ensureOp(id) {
    if (ops[id]) return ops[id];
    const r = await api.get(`/api/spec/ops/${id}`);
    if (!r.ok) return null;
    const full = r.json;
    setOps((m) => ({ ...m, [id]: full }));
    setValues((v) => ({ ...v, "ObjectMeta.Tenant": v["ObjectMeta.Tenant"] ?? conn?.tenant ?? "" }));
    return full;
  }
  async function toggle(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    await ensureOp(id);
  }

  async function run(op) {
    if (!conn || busy) return;
    const full = ops[op.id] ?? op;
    let parsed;
    try { parsed = JSON.parse(body); setBodyErr(""); } catch { setBodyErr("The request body is not valid JSON."); return; }
    setBusy(op.id);
    setResults((r) => ({ ...r, [op.id]: { pending: true } }));
    const r = await api.post(`/api/connections/${conn.id}/call`, { opId: op.id, values, body: parsed });
    if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 500 || r.status === 502) {
      setResults((res) => ({ ...res, [op.id]: { error: r.json?.error || "error", message: r.json?.message || `HTTP ${r.status}` } }));
    } else {
      setResults((res) => ({ ...res, [op.id]: r.json }));
    }
    setBusy(null);
  }

  if (!conn) {
    return <><h1>Explorer</h1><p>Select a connection first: the explorer calls the console it names.</p></>;
  }
  const matched = data?.matched ?? "…";
  const total = data?.total ?? "…";
  const renderCard = (o) => {
    const full = { ...o, params: ops[o.id]?.params ?? o.params ?? [] };
    return (
      <OpCard
        key={o.id}
        op={full}
        values={values}
        setValues={setValues}
        body={body}
        setBody={setBody}
        bodyErr={bodyErr}
        setBodyErr={setBodyErr}
        busy={busy}
        run={run}
        expanded={openId === o.id}
        onToggle={() => toggle(o.id)}
      />
    );
  };
  // Each card shows its own last result inside the expanded runner.
  const withResults = (list) => list.map((o) => (results[o.id] ? { ...o, _result: results[o.id] } : o));
  return (
    <>
      <h1>Explorer</h1>
      <p className="lede">All {total} operations from the Privilege console's swagger. Search is a substring match across method, path, service and summary — type <code>pi</code> to see every <code>pi*</code> path, <code>pacpolicys</code> for one collection. Press <strong>Run…</strong> on a card: parameters, the call and the result all happen inside the card.</p>
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
          grouped.map(([svc, list]) => (
            <section className="op-group" key={svc} data-testid="op-group">
              <h3 className="op-group-h">
                <button type="button" className="linkish" onClick={() => setCollapsed((c) => ({ ...c, [svc]: !c[svc] }))} aria-expanded={!collapsed[svc]} data-testid="op-group-toggle">
                  {collapsed[svc] ? "▸" : "▾"} <Untrusted text={svc} />
                </button>
                <span className="meta"> {list.length}</span>
              </h3>
              {!collapsed[svc] && (
                <ul className="plain">
                  {withResults(list).map(renderCard)}
                </ul>
              )}
            </section>
          ))
        ) : (
          <ul className="plain">
            {withResults(data?.operations ?? []).map(renderCard)}
          </ul>
        )}
      </section>
    </>
  );
}

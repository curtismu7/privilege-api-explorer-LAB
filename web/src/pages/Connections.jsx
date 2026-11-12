import React, { useState } from "react";
import * as api from "../api.js";
import HealthCard from "../components/HealthCard.jsx";
import { Untrusted } from "../lib/Untrusted.jsx";

const EMPTY = { kind: "privilege", label: "", url: "", tenant: "", apiKey: "", apiSecret: "", insecureTls: false };

function Field({ label, children, hint }) {
  return <label className="field">{label}{children}{hint && <small>{hint}</small>}</label>;
}

function Wizard({ onCreated, say }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setErr("");
    const body = { kind: "privilege", label: f.label, url: f.url, tenant: f.tenant, apiKey: f.apiKey, apiSecret: f.apiSecret, ...(f.insecureTls ? { insecureTls: true } : {}) };
    const r = await api.post("/api/connections", body);
    if (!r.ok) { setErr(r.json?.message || "Could not save the connection."); return; }
    setF((x) => ({ ...EMPTY, url: x.url })); // the secret is cleared; the server keeps the only copy
    say(`Connection ${r.json.label} saved.`);
    onCreated(r.json);
  }
  return (
    <form className="card" onSubmit={submit} aria-labelledby="wiz-h">
      <h2 id="wiz-h">Add a Privilege console connection</h2>
      <Field label="Name (optional)"><input value={f.label} onChange={set("label")} maxLength={80} placeholder="Local Privilege desktop console" /></Field>
      <Field label="Console origin" hint="The origin only, no path. Example: https://local.procyon.ai:8643 (http is allowed on loopback only).">
        <input value={f.url} onChange={set("url")} required placeholder="https://local.procyon.ai:8643" spellCheck="false" />
      </Field>
      <Field label="Tenant id" hint="The Privilege tenant UUID (shown in the console URL). Not a secret.">
        <input value={f.tenant} onChange={set("tenant")} required spellCheck="false" autoComplete="off" />
      </Field>
      <div className="grid2">
        <Field label="API key" hint="Settings → For Developers."><input value={f.apiKey} onChange={set("apiKey")} required spellCheck="false" autoComplete="off" /></Field>
        <Field label="API secret" hint="Write-only: kept on this machine's server, never shown again.">
          <input type="password" value={f.apiSecret} onChange={set("apiSecret")} required autoComplete="new-password" />
        </Field>
      </div>
      <label className="field"><input type="checkbox" checked={f.insecureTls} onChange={(e) => setF((x) => ({ ...x, insecureTls: e.target.checked }))} /> The console uses a self-signed certificate (allow it for this connection)</label>
      {err && <p className="err-text" role="alert">{err}</p>}
      <button type="submit" className="primary">Save connection</button>
    </form>
  );
}

function ConnCard({ c, active, onSelect, onChange, onTest, say }) {
  async function act(fn, msg) { const r = await fn(); if (!r.ok) say(r.json?.message || "That did not work."); else if (msg) say(msg); onChange(); return r; }
  const setWrites = (on) => act(() => api.post(`/api/connections/${c.id}/settings`, { allowWrites: on }), on ? `Writes enabled for ${c.label}.` : `Writes turned off for ${c.label}.`);
  return (
    <li className="card" data-state={active ? "active" : undefined} data-testid="conn-card">
      <div className="row between">
        <h3><Untrusted text={c.label} /></h3>
        <span className="chip">Privilege console</span>
      </div>
      <p className="meta">Console <code>{c.url}</code>, tenant <code>{c.tenant}</code>, key <code>{c.apiKey}</code>, secret: {c.apiSecret || "not set"}</p>
      <div className="row wrap">
        <button type="button" aria-pressed={active} onClick={() => onSelect(c.id)}>{active ? "In use" : "Use this connection"}</button>
        <button type="button" onClick={() => onTest(c.id)}>Test connection</button>
        <button type="button" onClick={() => { if (window.confirm(`Delete the connection "${c.label}"?`)) act(() => api.del(`/api/connections/${c.id}`), "Connection deleted."); }}>Delete</button>
      </div>
      <label className={`writes${c.allowWrites ? " writes--on" : ""}`}>
        <input type="checkbox" checked={c.allowWrites} onChange={(e) => setWrites(e.target.checked)} />
        Allow writes for this connection {c.allowWrites ? "(ON: write and destructive calls can run)" : "(off: GET calls only)"}
      </label>
    </li>
  );
}

export default function Connections({ mode, conns, activeId, onSelect, reload, tests, testBusy, runTest, say }) {
  const active = conns.find((c) => c.id === activeId);
  async function demo() {
    // The in-process mock: the connection's URL points at it after the server started it. The demo uses the mock's
    // accepted credential pair; the server answers with its sample tenant.
    const r = await api.post("/api/mock-url");
    if (!r.ok) { say("Could not reach the mock."); return; }
    const body = { kind: "privilege", label: "Mock console (sample tenant)", url: r.json.base, tenant: r.json.tenant, apiKey: r.json.apiKey, apiSecret: r.json.apiSecret };
    const c = await api.post("/api/connections", body);
    if (!c.ok) { say(c.json?.message || "Could not add the mock demo."); return; }
    say("Mock console connection added."); await reload(); onSelect(c.json.id); runTest(c.json.id);
  }
  return (
    <>
      <h1>Connections</h1>
      <p className="lede">A connection says which Privilege console to talk to (origin + tenant) and which API key/secret pair to use. The secret is write-only: after saving it shows as <q>set</q>. Writes are off for every new connection. The header toggle decides which connections are shown: Mock shows the mock demo, Real shows real consoles.</p>
      {mode === "mock" && (
        <section className="card" aria-labelledby="demo-h">
          <h2 id="demo-h">Try the mock</h2>
          <p>The mock console is an in-process Privilege console API on this machine (loopback only). The sample tenant is illustrative, not a recording, and write calls change only that in-memory sample.</p>
          <div className="row wrap">
            <button type="button" className="primary" onClick={demo}>Add mock console connection</button>
          </div>
          <p className="hint">To connect a real Privilege console, press Real in the header. Real is an owner opt-in and is refused until it is set up (see the README, Mock and real modes).</p>
        </section>
      )}
      {conns.length > 0 && <ul className="plain">{conns.map((c) => <ConnCard key={c.id} c={c} active={c.id === activeId} onSelect={onSelect} onChange={reload} onTest={runTest} say={say} />)}</ul>}
      {active && <HealthCard conn={active} test={tests[active.id]} busy={testBusy === active.id} />}
      {mode === "real" && <Wizard onCreated={async (c) => { await reload(); onSelect(c.id); }} say={say} />}
    </>
  );
}

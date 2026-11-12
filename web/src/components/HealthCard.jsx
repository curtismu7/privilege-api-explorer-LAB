import React from "react";

// Health card for the active connection. Shows whether the credential was proven and when. No secret is ever in
// the data this receives.
export default function HealthCard({ conn, test, busy }) {
  if (!conn) return null;
  return (
    <section className="card" aria-labelledby="health-h" data-testid="health-card">
      <h2 id="health-h">Connection check: {conn.label}</h2>
      <dl className="kv">
        <dt>Console</dt><dd><code>{conn.url}</code></dd>
        <dt>Tenant</dt><dd><code>{conn.tenant}</code></dd>
        <dt>API key</dt><dd>{conn.apiKey}</dd>
        <dt>API secret</dt><dd>{conn.apiSecret}</dd>
      </dl>
      {busy && <p>Checking the credential…</p>}
      {!busy && !test && <p className="conn-status conn-status--pending">Not tested yet. Press Test connection.</p>}
      {!busy && test && test.ok && <p className="conn-status conn-status--ok" data-state="ok" role="status" data-testid="conn-status-ok">Credential accepted (HTTP {test.status}, {test.ms} ms) on <code>{test.probed}</code>.</p>}
      {!busy && test && !test.ok && <p className="conn-status conn-status--bad err-text" role="alert">{test.error}: {test.message}</p>}
    </section>
  );
}

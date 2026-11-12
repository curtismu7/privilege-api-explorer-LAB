import React from "react";
import { Untrusted } from "../lib/Untrusted.jsx";

// The audit page: every call this app made, newest first. Entries arrive redacted (the server scrubs secrets before
// persisting); the page renders text nodes only.
export default function Audit() {
  const [entries, setEntries] = React.useState(null);
  const [err, setErr] = React.useState("");
  React.useEffect(() => {
    apiGet();
    async function apiGet() {
      const r = await fetch("/api/audit");
      if (r.ok) setEntries((await r.json()).entries);
      else setErr("Could not read the audit log.");
    }
  }, []);
  return (
    <>
      <h1>Audit</h1>
      <p className="lede">Every call this app made — ok, refused, blocked or error — newest first. The API secret is never in this log.</p>
      {err && <p className="err-text" role="alert">{err}</p>}
      {entries && entries.length === 0 && <p>No calls yet.</p>}
      {entries && entries.length > 0 && (
        <table data-testid="audit-table">
          <thead><tr><th>When</th><th>Operation</th><th>Outcome</th><th>Status</th><th>ms</th></tr></thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} data-testid="audit-row">
                <td><Untrusted text={(e.at || "").replace("T", " ").slice(0, 19)} /></td>
                <td><Untrusted text={e.op || ""} /></td>
                <td><Untrusted text={e.outcome || ""} /></td>
                <td>{e.status ?? ""}</td>
                <td>{e.ms ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

import React from "react";

// The banner names the mode the header toggle shows, on every page and in presenter mode, and says what is simulated (rule 2).
// Under it: the state that must never be missed, writes on (alert) or off.
export function bannerText(mode, conn) {
  if (mode === "mock") {
    return "MOCK mode, simulated. An in-process mock of the Privilege console API answers on this machine (loopback only). The sample tenant is illustrative, not a recording, and write calls change only that in-memory sample. Nothing leaves this machine.";
  }
  const where = conn ? ` In use: ${conn.label}.` : " No Real connection is selected yet: add one on Connections.";
  return `REAL mode, owner-run. Calls go to the Privilege console origin of the connection you use, with your saved API key and secret, and act on it.${where} Writes stay off until you enable them per connection.`;
}

export default function Banner({ mode, conn }) {
  return (
    <div data-testid="banner">
      <p className="banner" role="note" data-state={mode === "real" ? "live" : "mock"}>{bannerText(mode, conn)}</p>
      {conn && (conn.allowWrites
        ? <p className="notice" data-state="bad" role="alert"><strong>WRITES ARE ENABLED</strong> for {conn.label}. Write and destructive calls can run{mode === "real" ? ", on the real console" : " (against the in-memory sample tenant)"}.</p>
        : <p className="notice" data-state="ok" role="status">Writes are off. Read calls (GET) run; write and destructive calls are blocked.</p>)}
    </div>
  );
}

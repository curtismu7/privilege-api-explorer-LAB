import React from "react";

// The writes state that must never be missed: writes on (alert) or off. The simulation paragraph that used to sit above it is the
// Real-or-mock modal now (mode-modal/, rendered in App.jsx).
export default function WritesNotice({ mode, conn }) {
  if (!conn) return null;
  return (
    <div data-testid="writes-notice">
      {conn.allowWrites
        ? <p className="notice" data-state="bad" role="alert"><strong>WRITES ARE ENABLED</strong> for {conn.label}. Write and destructive calls can run{mode === "real" ? ", on the real console" : " (against the in-memory sample tenant)"}.</p>
        : <p className="notice" data-state="ok" role="status">Writes are off. Read calls (GET) run; write and destructive calls are blocked.</p>}
    </div>
  );
}

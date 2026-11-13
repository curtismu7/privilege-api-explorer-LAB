import React from "react";

// The configuration guide the Help button opens. Everything here is what a user must do in the
// Privilege console and in this app to make a working connection; it is documentation, not state.
export default function Help() {
  return (
    <>
      <h1>Help: configure the Privilege side</h1>
      <p className="lede">
        This app signs in to a PingOne Privilege console with a <strong>user API key and secret</strong> and then
        browses and calls that console's APIs. The console must issue the key, and it must be allowed to reach the
        collections you want to explore. Follow the two halves below: first the console, then this app.
      </p>

      <section className="card" aria-labelledby="help-console">
        <h2 id="help-console">Part 1 — in the Privilege console</h2>
        <ol>
          <li>
            <strong>Sign in</strong> to the Privilege console you want to explore (the local desktop app or your
            tenant's console URL). You need an account with a role that can create personal API keys.
          </li>
          <li>
            <strong>Create the API key.</strong> Open <em>Settings → For Developers</em> (the avatar/settings menu,
            bottom of the sidebar). Under API keys, press <strong>Create key</strong>. The console shows the
            <em> API key</em> and the <em>API secret</em> once — copy both immediately; the secret is never shown
            again.
          </li>
          <li>
            <strong>Copy the tenant UUID.</strong> It is the long ID in the console's own URL, right after
            <code> /api/</code> (for example
            <code> https://console.example.com/api/<em>0123abcd-…</em>/v1/users</code>). Every API path in this
            console starts with the tenant.
          </li>
          <li>
            <strong>Know what the key can do.</strong> The key inherits your user's permissions. If a call comes back
            <code> 401</code> or <code>403</code>, the credential or the role is the reason — this app shows the
            console's refusal as-is. Admin-only collections (for example <code>tenantapikeys</code>,
            <code> tenantprofile</code>) typically refuse user keys; that is the console's own behaviour, not a bug
            here.
          </li>
          <li>
            <strong>Self-signed certificate (local desktop console only).</strong> If the console URL is a local
            desktop app (for example <code>https://local.procyon.ai:8643</code>), its certificate is self-signed:
            tick <em>self-signed certificate</em> on the connection in this app. Never tick it for a cloud console.
          </li>
        </ol>
      </section>

      <section className="card" aria-labelledby="help-app">
        <h2 id="help-app">Part 2 — in this app</h2>
        <ol>
          <li>
            Open <a href="#/connections">Connections</a> and press <strong>Add connection</strong>. Fill in:
            the console <strong>origin</strong> (everything before <code>/api</code>), the <strong>tenant UUID</strong>,
            and the <strong>API key + secret</strong> from Part 1.
          </li>
          <li>
            Press <strong>Test connection</strong>. One real GET goes to the console; <code>200</code> means the
            credential works.
          </li>
          <li>
            Try the <a href="#/explorer">Explorer</a>: all 447 operations, grouped by service. Search is a substring
            match — type <code>pi</code> to see every <code>pi*</code> path. Open an operation, check the prefilled
            tenant, press <strong>Call</strong>.
          </li>
          <li>
            <strong>Writes stay off</strong> until you enable them per connection on the Connections page. DELETE and
            PATCH always need the switch. In Mock mode nothing is real anyway; in Real mode a write acts on the
            actual tenant.
          </li>
        </ol>
      </section>

      <section className="card" aria-labelledby="help-trouble">
        <h2 id="help-trouble">Troubleshooting</h2>
        <dl className="kv">
          <dt><code>the console refused the credential (HTTP 401)</code></dt>
          <dd>The key or secret is wrong (or rotated). Create a fresh key in the console and update the connection.</dd>
          <dt><code>HTTP 403</code> or <code>operation not allowed</code></dt>
          <dd>The key's role cannot touch that collection. Use a collection your user may read, or ask an admin for a role with the needed permissions.</dd>
          <dt><code>the console certificate is not trusted</code></dt>
          <dd>Local desktop console: tick <em>self-signed certificate</em> on the connection. Cloud console: fix the console's TLS, do not tick the box.</dd>
          <dt><code>the console did not answer in time</code></dt>
          <dd>The console origin is unreachable from this machine, or the port is wrong. Check the URL in a browser first.</dd>
          <dt>Nothing matches my search</dt>
          <dd>Search matches method, path, service and summary. Reset the service and method filters to <em>All</em>.</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="help-agent">
        <h2 id="help-agent">If the Privilege desktop agent shows &ldquo;unregistered&rdquo;</h2>
        <p>
          The local desktop console (<code>local.procyon.ai:8643</code>) is served by the PingOne Privilege
          desktop app&rsquo;s background agent. When its device record is deleted or unapproved on the cloud
          side, the local console stops serving and this app&rsquo;s Real connections fail with
          <code> the console did not answer in time</code>.
        </p>
        <dl>
          <dt>How to tell</dt>
          <dd>The desktop app shows the agent as <strong>unregistered</strong> (or its diagnostics print
          <code> Device &hellip; not found</code>), and <code>/Library/Logs/Procyon/procyon-agent.log</code> repeats
          <code>Error getting the device: 500 &hellip; &quot;Device &lt;id&gt; not found&quot;</code> every ~2 seconds.</dd>
          <dt>Fix (console approval &mdash; the agent cannot self-heal)</dt>
          <dd>Sign in to the cloud console (<code>console.pingone.com/?env=&lt;privilege-env-id&gt;</code> &rarr; PingOne
          Privilege &rarr; <strong>Devices</strong>), find this machine&rsquo;s device (<code>mac-&hellip;</code>, type MAC) and
          <strong>Approve</strong> it. If no pending row exists, toggle the agent off/on in the desktop app to mint a fresh
          certificate request, then approve. The agent picks it up within seconds and the local console serves again &mdash;
          no restart of this app needed.</dd>
          <dt>If it keeps coming back</dt>
          <dd>The deletes are console-side (admin, sync sweep, or a guard after network drops). Check
          <code> grep &quot;Delete request recieved&quot; /Library/Logs/Procyon/procyon-agent*.log</code> for the times and
          raise it with the tenant admin &mdash; re-approving treats the symptom only.</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="help-safe">
        <h2 id="help-safe">What this app does with the secret</h2>
        <p>
          The API secret is <strong>write-only</strong>: this app stores it in its owner-only data folder, uses it to
          sign each call (<code>x-api-key</code> / <code>x-api-secret</code> plus a fresh
          <code> x-procyon-session-id</code> per call), and never returns it to the page, never logs it. In Mock mode
          nothing leaves this machine. In Real mode, only the connection's own console origin is reachable.
        </p>
        <p className="meta">
          Full docs: the repository README at
          <code> github.com/curtismu7/privilege-api-explorer-LAB</code>.
        </p>
      </section>
    </>
  );
}

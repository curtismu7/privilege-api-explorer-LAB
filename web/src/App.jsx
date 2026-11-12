import React, { useCallback, useEffect, useState } from "react";
import fs from "node:fs";
import ShelfLink from "./components/ShelfLink.jsx";
import * as api from "./api.js";
import Banner from "./components/Banner.jsx";
import Audit from "./pages/Audit.jsx";
import Connections from "./pages/Connections.jsx";
import Diagram from "./pages/Diagram.jsx";
import Explorer from "./pages/Explorer.jsx";
import { PresentBar, PresentProvider, usePresent } from "./present/Present.jsx";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || null; } catch { return null; } })();

const NAV = [["explorer", "Explorer"], ["connections", "Connections"], ["audit", "Audit"], ["diagram", "Diagram"]];
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};
const parseHash = () => { const [, page = "explorer", rest = ""] = window.location.hash.replace(/^#/, "").split("/"); return { page, rest: decodeURIComponent(rest) }; };

export default function App() {
  return <PresentProvider><Shell /></PresentProvider>;
}

function Shell() {
  const { present, set: setPresent } = usePresent();
  const [fontStep, setFontStep] = useState(() => { const f = store.get("pae.font"); return ["S", "M", "L"].includes(f) ? f : "M"; });
  useEffect(() => { applyFontSize(fontStep); store.set("pae.font", fontStep); }, [fontStep]);
  const [route, setRoute] = useState(parseHash);
  const [conns, setConns] = useState([]);
  const [activeId, setActiveId] = useState(() => store.get("pae.active"));
  const [tests, setTests] = useState({});
  const [testBusy, setTestBusy] = useState(null);
  const [msg, setMsg] = useState("");
  const [theme, setTheme] = useState(() => store.get("pae.theme") || "system");
  const [info, setInfo] = useState(null); // GET /api/info; null = not known yet
  const [mode, setModeState] = useState("mock");
  const [refusal, setRefusal] = useState("");
  const [epoch, setEpoch] = useState(0); // bumped by Reset: remounts the page, so the form fields start over
  const say = useCallback((m) => setMsg(m), []);
  const realOk = Boolean(info?.real?.available);
  // The header toggle. Rule 19: the mode is server-side (POST /api/mode). Real is disabled with the server's reason
  // while the Real guards do not pass; a refused switch (409) is shown, and the page stays in Mock.
  const setMode = async (m) => {
    if (m === "real" && !realOk) {
      const why = info?.real?.needs?.length ? info.real.needs.join(" ") : "The server did not say Real is available.";
      setRefusal(`Real is refused${info?.real?.failed?.length ? ` (${info.real.failed.join(", ")})` : ""}. ${why} Nothing was sent; the page stays in Mock.`);
      return;
    }
    const r = await api.post("/api/mode", { source: m });
    if (!r.ok) { setRefusal(r.json?.message || "The mode switch was refused."); return; }
    setRefusal(""); setModeState(m);
  };

  useEffect(() => {
    api.get("/api/info").then((r) => {
      const i = r.ok ? r.json : { real: { available: false, failed: ["unreachable"], needs: [] } };
      setInfo(i);
      if (r.ok && i.source === "real") setModeState("real"); // the server's mode wins on load
    });
  }, []);
  useEffect(() => { const f = () => setRoute(parseHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; store.set("pae.theme", theme); }, [theme]);

  const reload = useCallback(async () => { const r = await api.get("/api/connections"); if (r.ok) setConns(r.json.connections); return r.ok ? r.json.connections : []; }, []);
  const select = useCallback((id) => { setActiveId(id); store.set("pae.active", id); }, []);
  // The mode decides which saved connections the page works with: Mock uses the in-process mock console (a connection
  // whose URL is loopback — the same criterion the server uses), Real uses the real consoles. Never the label: labels
  // are free text.
  const isLoopbackConn = (c) => { try { return ["127.0.0.1", "localhost", "::1"].includes(new URL(c.url).hostname); } catch { return false; } };
  const modeConns = conns.filter((c) => (mode === "mock") === isLoopbackConn(c));
  const active = modeConns.find((c) => c.id === activeId) || modeConns[0] || null;

  const runTest = useCallback(async (id) => {
    setTestBusy(id); say("Testing the credential…");
    const r = await api.post(`/api/connections/${id}/test`);
    const t = r.ok ? r.json : { ok: false, error: r.json?.error || "error", message: r.json?.message || "The test failed." };
    setTests((x) => ({ ...x, [id]: t }));
    setTestBusy(null);
    say(t.ok ? `Credential accepted (HTTP ${t.status}, ${t.ms} ms).` : `Connection check failed: ${t.message}`);
    reload();
  }, [reload, say]);

  useEffect(() => {
    (async () => {
      const list = await reload();
      if (!list.some((c) => c.id === store.get("pae.active"))) setActiveId(list[0]?.id ?? null);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function reset() {
    const r = await api.post("/api/reset");
    setEpoch((n) => n + 1); setTests({});
    await reload();
    say(r.ok ? "Reset: audit history cleared, writes turned off, diagram restored. Saved connections kept." : "Reset failed: could not reach the server.");
  }

  const page = (() => {
    switch (route.page) {
      case "explorer": return <Explorer conn={active} />;
      case "connections": return <Connections mode={mode} conns={modeConns} activeId={active?.id ?? null} onSelect={select} reload={reload} tests={tests} testBusy={testBusy} runTest={runTest} say={say} />;
      case "audit": return <Audit />;
      case "diagram": return <Diagram theme={theme} />;
      default: return <Explorer conn={active} />;
    }
  })();

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="top">
        <Banner mode={mode} conn={active} />
        <div className="top__bar">
          <h1 className="top__title">Privilege API Explorer LAB</h1>
          <div className="top__tools">
            <TopMenu
              mode={{ value: mode, onChange: setMode, realAvailable: info ? realOk : null, realHint: info?.real?.needs?.length ? `Real is refused (${(info.real.failed ?? []).join(", ")}). ${info.real.needs.join(" ")}` : undefined }}
              theme={{ value: theme, onChange: setTheme }}
              fontSize={{ value: fontStep, onChange: setFontStep }}
              present={{ active: present, onToggle: () => setPresent(!present) }}
              shelfUrl="https://local.ping-devops.com:8443/"
              help={{ href: "https://github.com/curtismu7/privilege-api-explorer-LAB#readme" }}
              version={VERSION}
              onReset={reset}
            >
              <ShelfLink />
              <span className="chip" data-testid="mode">Mode: {mode}</span>
            </TopMenu>
          </div>
        </div>
        {refusal && <p className="notice" data-state="bad" role="alert" data-testid="refusal">{refusal}</p>}
        <nav className="top__nav" aria-label="Pages">
          {NAV.map(([id, label]) => <a key={id} className="top__link" href={`#/${id}`} aria-current={route.page === id ? "page" : undefined}>{label}</a>)}
        </nav>
      </header>
      <PresentBar />
      <main id="main" tabIndex={-1} key={epoch}>{page}</main>
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="live">{msg}</p>
      <footer className="foot">No accounts here: this app runs on your machine and holds your connections. The Privilege console's own refusals (401/403) are shown as-is; claims are marked UNVERIFIED where we have not verified them (docs/references.md).</footer>
    </>
  );
}

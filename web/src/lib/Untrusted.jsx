// Untrusted: everything a remote party sends is untrusted by definition — it is only ever rendered as React text
// nodes (never innerHTML), so markup in a payload is shown, not run. Optional `hot` regex highlights suspicious
// spans (title + text, never colour alone). Family shared service (owner, 2026-11-13): vendor it, never edit a
// lab's copy.
import React from "react";

export function segments(text, hot = null) {
  const s = String(text ?? "");
  if (!hot) return [{ text: s, hot: false }];
  const out = [];
  let last = 0;
  for (const m of s.matchAll(hot)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hot: false });
    out.push({ text: m[0], hot: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), hot: false });
  return out;
}

const CHIP = /(\[U\+[0-9A-F]{4,6}\])/;
const chips = (text) => String(text).split(CHIP).map((p, i) => (i % 2 ? <span key={i} className="chip" title="Invisible or look-alike character">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>));

export function Untrusted({ text, revealed, block = false, hot = null, testId = "untrusted" }) {
  const show = revealed === undefined ? (t) => t : chips;
  const Tag = block ? "pre" : "span";
  return (
    <Tag className={`untrusted${block ? " untrusted--block" : ""}`} data-testid={testId}>
      {segments(text, hot).map((seg, i) => (
        <React.Fragment key={i}>
          {seg.hot ? <mark title="Suspicious pattern">{show(seg.text)}</mark> : show(seg.text)}
        </React.Fragment>
      ))}
    </Tag>
  );
}
export default Untrusted;

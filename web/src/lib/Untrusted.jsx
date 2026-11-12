import React from "react";

// Every server-supplied string is rendered as a text node through Untrusted, so a hostile value in the console's
// answer can never become markup. (The UI never uses dangerouslySetInnerHTML at all; this component is the habit
// that keeps it that way.)
export function Untrusted({ text }) {
  return <>{String(text ?? "")}</>;
}

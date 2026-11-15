// Pure helpers for the UI. No tokens or secrets pass through here: the API never returns them.

const METHOD_LABEL = { GET: "read", POST: "write", PUT: "write", PATCH: "write", DELETE: "destructive" };
export const classOf = (op) => METHOD_LABEL[op.method] || "write";

/** The exact redirect URI idea is gone (no OAuth here). Kept: the mock tenant placeholder. */
export const DEMO_TENANT = "11111111-2222-4333-8444-555555555555"; // placeholder, not a tenant

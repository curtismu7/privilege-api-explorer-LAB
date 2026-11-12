#!/usr/bin/env node
// Generates content-pack.json (repo root) for the Learning Hub. Format: docs/content-pack.schema.json (copy of the ID-JAG kit's).
// Deterministic: lists sorted by id, 2-space JSON, no timestamps; a commit is recorded only when passed (--commit=<sha>).
// Sources: none. A source is listed only if its URL was fetched this build or verified; the swagger snapshot is a local
// file reduced to a catalog at build time, so the list is empty on purpose.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const CARDS = [
  { id: 'connections', label: 'Connect to a console', description: 'A connection names the console origin, the tenant UUID and the API key/secret pair. The secret is write-only. Mock: the in-process mock console.', group: 'setup', href: '/#/connections', terms: ['privilege-console-api', 'api-key-secret', 'tenant-id'] },
  { id: 'explorer', label: 'Browse the API', description: 'All 447 console operations from the swagger catalog. Search is a substring match — "pi" shows every pi* path; narrow by service or method.', group: 'try-it', href: '/#/explorer', terms: ['swagger-catalog'] },
  { id: 'call', label: 'Run an operation', description: 'Fill the spec\'s parameters, press Call, and the result pane shows the HTTP status, elapsed ms, the exact path and the raw body, in real time.', group: 'try-it', href: '/#/explorer', terms: ['procyon-session-id'] },
  { id: 'writes', label: 'Read-only by default', description: 'GET runs; POST and PUT need the writes switch; DELETE and PATCH always need it. Blocked calls are honest and audited.', group: 'concept', href: '/#/connections', terms: ['read-only-by-default'] },
  { id: 'audit', label: 'Audit log', description: 'Every call, allowed or blocked, redacted. The API secret is never in it.', group: 'reference', href: '/#/audit', terms: ['audit-log'] },
  { id: 'diagram', label: 'Diagram', description: 'Browser, app, mock and real console. Movable boxes, Simulate, Reset, speed.', group: 'concept', href: '/#/diagram' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'privilege-api-explorer',
    title: 'Privilege API Explorer LAB',
    version: pkg.version,
    ...(commit ? { source: { repo: 'privilege-api-explorer-LAB', commit } } : {}),
    demo: { id: 'privilege-api-explorer', name: 'Privilege API Explorer LAB', catalog: 'D131', baseUrl: 'http://localhost:7813', doctor: '/api/health', tags: ['rest-api', 'privilege', 'admin-plane', 'read-only'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'connection-path', label: 'Browser, app, mock console, real console', href: '/#/diagram' }],
    stories: [],
  };
  return pack;
}
export const serialize = (p) => `${JSON.stringify(p, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${PACK_PATH}`);
}

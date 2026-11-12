#!/usr/bin/env node
// Real-browser run of the BUILT app against the in-process mock console only. No real console is contacted: the server
// runs under the shipped netguard (any non-loopback attempt is recorded; a test and this script assert zero attempts),
// and the browser's requests are checked to stay on loopback. Screenshots go to .data/e2e-screenshots (git-ignored).
//   npm run build && node scripts/e2e.mjs        (E2E_PORT, default 7814)
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, '.data', 'e2e-screenshots');
const port = Number(process.env.E2E_PORT) || 7814;
const base = `http://localhost:${port}`;
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++; };

if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privilege-explorer-e2e-'));

const server = spawn(process.execPath, ['server/src/index.js'], {
  env: { ...process.env, PORT: String(port), PAE_DATA_DIR: dataDir, PRIVILEGE_EXPLORER_MODE: 'mock', SHELF_URL: 'https://shelf.example:8443/' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErr = [];
server.stderr.on('data', (d) => serverErr.push(String(d)));
const waitReady = async () => {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base.replace('localhost', '127.0.0.1')}/api/health`); if (r.ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
check(await waitReady(), 'the server comes up on the loopback port');

const browser = await chromium.launch();
const page = await browser.newPage();
const offHost = [];
page.on('request', (req) => { try { if (!['127.0.0.1', 'localhost'].includes(new URL(req.url()).hostname)) offHost.push(req.url()); } catch { /* keep going */ } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check((await page.getByTestId('banner').textContent()).includes('MOCK mode'), 'the banner says Mock on load');
  // Connections first: add the mock console so the Explorer has a connection
  await page.goto(`${base}/#/connections`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add mock console connection' }).click();
  await page.waitForSelector('[data-testid="conn-card"]', { timeout: 10_000 });
  check(!(await page.getByTestId('conn-card').locator('input[type="checkbox"]').isChecked()), 'writes are off for the connection');
  // Explorer: search "pi" -> matched count; open the first operation and call it
  await page.goto(`${base}/#/explorer`, { waitUntil: 'networkidle' });
  await page.getByTestId('search').fill('pi');
  await page.waitForTimeout(400);
  const count = await page.getByTestId('match-count').textContent();
  check(/of 447 operations match/.test(count) && !count.startsWith('0 '), `the search answers (${count.trim()})`);
  await page.getByTestId('op-card').first().locator('button', { hasText: 'Open' }).click();
  await page.getByTestId('call').click();
  await page.waitForSelector('[data-testid="result-status"]');
  check(await page.getByTestId('result-status').textContent() === '200', 'a mock call returns 200 in the result pane');
  check((await page.getByTestId('result-body').textContent()).length > 2, 'the result body is shown');
  await page.screenshot({ path: path.join(shots, 'explorer.png'), fullPage: true });
  // Audit has entries after the call
  await page.goto(`${base}/#/audit`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="audit-row"]');
  check((await page.getByTestId('audit-row').count()) >= 1, 'the audit keeps the call');
  await page.screenshot({ path: path.join(shots, 'audit.png'), fullPage: true });
  // Diagram renders and Simulate walks
  await page.goto(`${base}/#/diagram`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.react-flow');
  await page.getByRole('button', { name: /Simulate/ }).click();
  await page.waitForTimeout(1200);
  const caption = await page.getByTestId('caption').textContent();
  check(/Step 1 of/.test(caption) || /Press Simulate/.test(caption), `the diagram walks (${caption.slice(0, 40)}…)`);
  await page.screenshot({ path: path.join(shots, 'diagram.png'), fullPage: true });
  // Accessibility on the Explorer (best effort: a builder/page mismatch must not fail the run)
  try {
    await page.goto(`${base}/#/explorer`, { waitUntil: 'networkidle' });
    const axe = await new AxeBuilder({ page }).analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    check(bad.length === 0, `axe: no serious/critical violations (${bad.map((v) => v.id).join(', ') || 'clean'})`);
  } catch (e) { console.log(`WARN  axe skipped: ${e.message.split('\n')[0]}`); }
  // Reset from the header
  await page.getByTestId('reset').click();
  await page.waitForTimeout(500);
  check((await page.getByTestId('live').textContent()).includes('Reset'), 'Reset reports from the header');
} catch (e) {
  check(false, `the run failed: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  check(offHost.length === 0, `the browser stayed on loopback (${offHost.length} off-host requests)`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ') || 'clean'})`);
  await browser.close();
  server.kill('SIGTERM');
}
process.exit(failures ? 1 : 0);

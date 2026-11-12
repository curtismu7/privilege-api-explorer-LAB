// Mode and port configuration.
//
// PRIVILEGE_EXPLORER_MODE is the owner's opt-in for Real. mock (the default) keeps Real refused; real lets the header
// toggle go to Real. The page always opens in Mock; Real is entered by pressing the header toggle each time (nothing
// is remembered). A bare MODE is NOT read: the shared settings file is read by every standalone app, and another app's
// MODE must not switch this one. Anything that is not mock or real is an error, never a silent fallback.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindHost, isLoopbackHost } from './security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PORT = 7813;
export const PORT_MIN = 7800;
export const PORT_MAX = 7999;
export const port = (env = process.env) => Number(env.PORT) || DEFAULT_PORT;
export const portInRange = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX;
export const dataDir = (env = process.env) => path.resolve(root, env.PAE_DATA_DIR || '.data');
export const webDist = path.join(root, 'web', 'dist');

export const MODES = Object.freeze(['mock', 'real']);
export const MODE_KEY = 'PRIVILEGE_EXPLORER_MODE';

export function modeFrom(env = process.env) {
  const raw = env[MODE_KEY];
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`${MODE_KEY}=${String(m).slice(0, 20).replace(/[^\x20-\x7e]/g, '?')} is not a mode: use mock or real`);
  return m;
}

// The guards Real must pass before any saved connection is used. Each: { id, ok, detail }. Every real connection is
// then checked again when it is saved (https, or http on loopback only; no credentials in the URL; no literal private
// address; see store.js).
export function realGuards(env = process.env) {
  const host = bindHost(env);
  return [
    { id: 'owner-opt-in', ok: env[MODE_KEY] === 'real', detail: `${MODE_KEY}=real is set in the shared settings file (~/Development/.env, or the path in STANDALONE_ENV) or the environment` },
    { id: 'loopback-bind', ok: isLoopbackHost(host) || (Boolean(env.PAE_BIND) && env.PAE_CONTAINER === '1'), detail: 'the server is bound to loopback; a non-loopback bind (PAE_BIND) is accepted for Real only inside the container image, which sets PAE_CONTAINER=1 and is published on 127.0.0.1 only' },
  ];
}
// null when Real may run; otherwise which guards failed and what each needs.
export function realRefusal(env = process.env) {
  const failed = realGuards(env).filter((g) => !g.ok);
  return failed.length ? { failed: failed.map((g) => g.id), needs: failed.map((g) => g.detail) } : null;
}

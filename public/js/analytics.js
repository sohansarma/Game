// Anonymous usage analytics (see /privacy.html).
//
//  • No cookies, no name, no account, no IP log, no advertising id.
//  • Events are tiny: an event name, a coarse bucket and sometimes a number
//    (e.g. seconds played). They are batched and sent in one request.
//  • Adults who left "usage counts" on also send a random install id kept in
//    this browser only (never in the save, so it never reaches an account).
//    It lets the team see day-1/7/30 return rates. Switching counts off
//    deletes it here and on the server.
//  • Under-13s (and anyone who hasn't answered the age screen yet) never get
//    an id: their events only add to anonymous tallies. Nothing is sent
//    until the age screen has been answered.

import { load } from './storage.js';
import { policy } from './policy.js';

const KEY = 'tidepop-iid';
const IID_RE = /^[a-f0-9]{32}$/;
const MAX_QUEUE = 50, BATCH = 25, FLUSH_MS = 4000;

let cfg = { base: '/api', off: () => false };
let queue = [];
let timer = null;
let errCount = 0;
let started = false;

export function configure(c) {
  cfg = { ...cfg, ...c };
}

export const platform = () => {
  try { return window.Capacitor?.isNativePlatform?.() || document.referrer.startsWith('android-app://') ? 'app' : 'web'; } catch { return 'web'; }
};

const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } },
  del() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } },
};

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The install id for retention – only adults with counts on; created on first use. */
export function installId() {
  if (!policy().installId) { store.del(); return null; }
  let id = store.get();
  if (!IID_RE.test(id || '')) { id = randomHex(16); store.set(id); }
  return id;
}

/** Record one event. Never throws; does nothing when counts are off or inside the Claude artifact. */
export function track(e, b = '-', n) {
  try {
    if (cfg.off() || load().settings.analytics === false) return;
    const bucket = String(b).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || '-';
    const ev = { e, b: bucket };
    if (Number.isFinite(n)) ev.n = Math.max(0, Math.min(86400, Math.round(n)));
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(ev);
    if (!timer && typeof setTimeout === 'function') timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  } catch { /* counting must never break the game */ }
}

function post(path, body, keepalive) {
  const json = JSON.stringify(body);
  try {
    if (keepalive && navigator.sendBeacon && navigator.sendBeacon(cfg.base + path, new Blob([json], { type: 'application/json' }))) return;
  } catch { /* fall through to fetch */ }
  fetch(cfg.base + path, { method: 'POST', body: json, headers: { 'content-type': 'application/json' }, keepalive: !!keepalive }).catch(() => {});
}

/** Send what is queued. Held back until the age screen has been answered. */
export function flush({ final = false } = {}) {
  try {
    if (!queue.length) return;
    const p = policy();
    if (!p.ageKnown || cfg.off() || load().settings.analytics === false) { if (load().settings.analytics === false) queue = []; return; }
    const iid = installId();
    while (queue.length) {
      const list = queue.splice(0, BATCH);
      post('/events', { aud: p.analyticsAud, plat: platform(), ...(iid ? { iid } : {}), list }, final);
      if (!final) break;
    }
    if (queue.length && !timer) timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  } catch { /* ignore */ }
}

/** Call after the age screen is answered: held events can go now. */
export const ageAnswered = () => flush();

/** "Delete my usage data": removes the install id here and everything stored under it on the server. */
export function forgetUsage() {
  try {
    const id = store.get();
    queue = [];
    store.del();
    if (IID_RE.test(id || '')) post('/events/forget', { iid: id }, false);
  } catch { /* ignore */ }
}

/** Page-wide signals: crashes, load speed, installs, and sending on the way out. Safe to call twice. */
export function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const hide = () => flush({ final: true });
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hide(); });
  const err = (b) => { if (errCount++ < 5) track('err', b); }; // a crash loop must not flood the server
  window.addEventListener('error', () => err('js'));
  window.addEventListener('unhandledrejection', () => err('promise'));
  window.addEventListener('appinstalled', () => track('install', 'pwa'));
  const perf = () => setTimeout(() => {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    const t = nav?.loadEventEnd;
    if (t > 0) track('perf', t < 1000 ? 'fast' : t < 3000 ? 'mid' : 'slow');
  }, 0);
  if (document.readyState === 'complete') perf(); else window.addEventListener('load', perf, { once: true });
}

/** Report a server/network failure (not 4xx – those are the player's own mistakes). */
export function apiError() {
  if (errCount++ < 5) track('err', 'api');
}

// Leaderboard client. Talks to the (optional, free, self-hostable) Tidepop
// server. If no server is reachable the game keeps working and submissions
// are queued locally until it is.

import { load, update } from './storage.js';

const BASE = (typeof window !== 'undefined' && window.TIDEPOP_API !== undefined ? window.TIDEPOP_API : '') + '/api';
let online = null; // null = unknown

async function req(path, opts = {}, timeout = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      ...opts,
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    online = true;
    return body;
  } catch (e) {
    if (!e.status) online = false;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function isOnline() {
  return online;
}

export async function checkServer() {
  try {
    await req('/health', {}, 3000);
  } catch {
    online = false;
  }
  return online;
}

async function ensureRegistered() {
  const s = load();
  if (s.token) return s;
  const r = await req('/register', { method: 'POST', body: JSON.stringify({ playerId: s.playerId, name: s.name }) });
  update((d) => { d.token = r.token; d.playerId = r.playerId; });
  return load();
}

export async function rename(name) {
  const s = await ensureRegistered();
  return req('/rename', { method: 'POST', body: JSON.stringify({ playerId: s.playerId, token: s.token, name }) });
}

export async function forgetMe() {
  const s = load();
  if (!s.token) return { ok: true };
  const r = await req('/forget', { method: 'POST', body: JSON.stringify({ playerId: s.playerId, token: s.token }) });
  update((d) => { d.token = null; });
  return r;
}

/** Submit a run. entry = { board, key, log, seed?, level? } */
export async function submit(entry) {
  const s = load();
  if (!s.settings.leaderboard) return { skipped: true };
  try {
    const p = await ensureRegistered();
    const res = await req('/scores', {
      method: 'POST',
      body: JSON.stringify({ ...entry, playerId: p.playerId, token: p.token }),
    });
    return res;
  } catch (e) {
    if (!e.status) {
      // network problem – queue for later (keep the queue small)
      update((d) => { d.pending = [...d.pending, entry].slice(-20); });
      return { queued: true };
    }
    throw e;
  }
}

export async function flushPending() {
  const s = load();
  if (!s.pending.length || !s.settings.leaderboard) return 0;
  const pending = [...s.pending];
  let sent = 0;
  for (const entry of pending) {
    try {
      const p = await ensureRegistered();
      await req('/scores', { method: 'POST', body: JSON.stringify({ ...entry, playerId: p.playerId, token: p.token }) });
      sent++;
    } catch (e) {
      if (!e.status) break; // still offline
      sent++; // server rejected (e.g. expired day) – drop it
    }
  }
  update((d) => { d.pending = d.pending.slice(sent); });
  return sent;
}

export async function top(board, key) {
  const s = load();
  const q = new URLSearchParams({ board, key: key || 'all', playerId: s.playerId });
  return req('/leaderboard?' + q.toString());
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushPending().catch(() => {}));
}

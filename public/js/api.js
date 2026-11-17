// Leaderboard client. Talks to the (optional, free, self-hostable) Tidepop
// server. If no server is reachable the game keeps working and submissions
// are queued locally until it is.

import { load, update } from './storage.js';
import { replay } from './engine.js';
import { replayBlocks } from './blocks.js';
import { getLevel } from './levels.js';
import { BOARDS, acceptableKeys, dailyConfig, deepConfig, blocksSeed, dayKey } from './modes.js';

const BASE = (typeof window !== 'undefined' && window.TIDEPOP_API !== undefined ? window.TIDEPOP_API : '') + '/api';
let online = null; // null = unknown

// ---------------------------------------------------------------------------
// Shared-database backend. When the game runs as a claude.ai Artifact there
// is no Node server; the artifact's own document store holds the boards.
// Each player owns one document `players/<id>`; everyone can read them all.
// Runs are re-checked by replaying the action log before being written, and
// the logs of ranked dives are stored so they can be audited later.
let shared; // undefined = not probed, null = unavailable, else { db, uid }
async function sharedDb() {
  if (shared !== undefined) return shared;
  if (typeof window === 'undefined' || !window.claude?.use) return (shared = null);
  try {
    const timeout = new Promise((r) => setTimeout(() => r(null), 10000));
    const [db, user] = await Promise.race([Promise.all([window.claude.use('db'), window.claude.use('user')]), timeout.then(() => [null, null])]);
    const uid = db && user ? await user.id() : null;
    shared = db && uid ? { db, uid } : null;
  } catch {
    shared = null;
  }
  return shared;
}

/** True when running inside the claude.ai artifact viewer. */
export function inArtifact() {
  return typeof window !== 'undefined' && !!window.claude?.use;
}

const SIGN_IN = 'Sign in to Claude to join the shared leaderboard. Your scores are saved on this device.';

export function backendKind() {
  return shared ? 'shared' : online ? 'server' : null;
}

function verifyLocally(entry) {
  const { board } = entry;
  if (!BOARDS[board]) throw Object.assign(new Error('unknown board'), { status: 400 });
  if (board === 'stars') {
    const r = replay(getLevel(entry.level, entry.seed), entry.log, { maxBoosters: 8 });
    if (!r.ok || r.game.state !== 'won') throw Object.assign(new Error('replay failed'), { status: 422 });
    return { stars: r.game.stars() };
  }
  if (!acceptableKeys(board).includes(entry.key)) throw Object.assign(new Error('this board is closed'), { status: 422 });
  let g;
  if (board === 'daily' || board === 'deep') {
    const r = replay(board === 'daily' ? dailyConfig(entry.key) : deepConfig(entry.key), entry.log, { maxBoosters: 0 });
    if (!r.ok || r.game.state === 'playing') throw Object.assign(new Error('replay failed'), { status: 422 });
    g = r.game;
  } else {
    const r = replayBlocks(blocksSeed(board, entry.key, entry.seed), entry.log);
    if (!r.ok || r.game.state !== 'over') throw Object.assign(new Error('replay failed'), { status: 422 });
    g = r.game;
  }
  if (typeof entry.score === 'number' && entry.score !== g.score) throw Object.assign(new Error('score mismatch'), { status: 422 });
  return { score: g.score };
}

async function sharedSubmit(sh, entry) {
  const v = verifyLocally(entry);
  const s = load();
  const ref = sh.db.collection('players').doc(sh.uid);
  const snap = await ref.get();
  const doc = snap.exists ? snap.data() : { scores: {}, levels: {} };
  doc.scores ||= {};
  doc.levels ||= {};
  const now = Date.now();
  let id, score;
  if (entry.board === 'stars') {
    doc.levels[entry.level] = Math.max(doc.levels[entry.level] || 0, v.stars);
    score = Object.values(doc.levels).reduce((a, b) => a + b, 0);
    id = 'stars:all';
  } else {
    id = `${entry.board}:${entry.key}`;
    score = v.score;
  }
  const prev = doc.scores[id];
  const keepFirst = entry.board === 'daily';
  if (!prev || (!keepFirst && score > prev.s)) {
    doc.scores[id] = { s: score, t: now, ...(entry.board === 'daily' || entry.board === 'deep' ? { log: entry.log } : {}) };
  }
  // drop boards older than 30 days to keep the document small
  const cutoff = dayKey(new Date(now - 30 * 86400000));
  for (const k of Object.keys(doc.scores)) {
    const [b, key] = k.split(':');
    if (BOARDS[b]?.period === 'day' && key < cutoff) delete doc.scores[k];
    if (BOARDS[b]?.period === 'week' && doc.scores[k].t < now - 84 * 86400000) delete doc.scores[k];
  }
  doc.name = s.name;
  doc.updatedAt = now;
  await ref.set(doc);
  const board = await sharedTop(sh, entry.board, entry.board === 'stars' ? 'all' : entry.key);
  return { ok: true, rank: board.me?.rank, best: doc.scores[id].s, verified: score };
}

async function sharedTop(sh, board, key) {
  const id = `${board}:${key || 'all'}`;
  const snap = await sh.db.collection('players').get();
  const rows = [];
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const e = data.scores?.[id];
    if (e && typeof e.s === 'number') rows.push({ pid: d.id, name: String(data.name || 'Mystery Fish').slice(0, 40), score: e.s, at: e.t || 0 });
  });
  rows.sort((a, b) => b.score - a.score || a.at - b.at);
  const entries = rows.slice(0, 50).map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, me: r.pid === sh.uid }));
  const myIdx = rows.findIndex((r) => r.pid === sh.uid);
  return { board, key, total: rows.length, entries, me: myIdx >= 0 ? { rank: myIdx + 1, score: rows[myIdx].score } : null };
}

function friendly(e) {
  const code = e?.code || '';
  if (code === 'invalid_argument' || code === 'permission_denied' || code === 'not_granted') {
    return Object.assign(new Error('You have view-only access, so your scores stay on this device.'), { status: 403 });
  }
  return e?.status ? e : Object.assign(new Error(e?.message || 'leaderboard unavailable'), { status: 503 });
}

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
  if (await sharedDb()) return (online = true);
  if (inArtifact()) return (online = false); // no Node server behind an artifact
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
  const sh = await sharedDb();
  if (sh) {
    const ref = sh.db.collection('players').doc(sh.uid);
    const snap = await ref.get();
    if (snap.exists) await ref.update({ name });
    return { ok: true };
  }
  const s = await ensureRegistered();
  return req('/rename', { method: 'POST', body: JSON.stringify({ playerId: s.playerId, token: s.token, name }) });
}

export async function forgetMe() {
  const sh = await sharedDb();
  if (sh) {
    await sh.db.collection('players').doc(sh.uid).delete();
    return { ok: true };
  }
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
  const sh = await sharedDb();
  if (sh) {
    try {
      return await sharedSubmit(sh, entry);
    } catch (e) {
      throw friendly(e);
    }
  }
  if (inArtifact()) return { error: SIGN_IN };
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
  if (await sharedDb()) return 0;
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
  const sh = await sharedDb();
  if (sh) {
    try {
      return await sharedTop(sh, board, key);
    } catch (e) {
      throw friendly(e);
    }
  }
  if (inArtifact()) throw Object.assign(new Error(SIGN_IN), { status: 401 });
  const s = load();
  const q = new URLSearchParams({ board, key: key || 'all', playerId: s.playerId });
  return req('/leaderboard?' + q.toString());
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushPending().catch(() => {}));
}

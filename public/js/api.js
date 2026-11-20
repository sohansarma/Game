// Leaderboard client. Talks to the (optional, free, self-hostable) Tidepop
// server. If no server is reachable the game keeps working and submissions
// are queued locally until it is.

import { load, update } from './storage.js';
import { replay } from './engine.js';
import { replayBlocks } from './blocks.js';
import { getLevel } from './levels.js';
import { verifyArcade } from './arcade/index.js';
import { BOARDS, acceptableKeys, dailyConfig, deepConfig, blocksSeed, dayKey, weekKey } from './modes.js';

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
    shared = db && uid ? { db, uid, user } : null;
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
  if (BOARDS[board].arcade) {
    const v = verifyArcade(board, entry.key, Number(entry.seed), entry.log);
    if (!v.ok) throw Object.assign(new Error('replay failed: ' + v.reason), { status: 422 });
    if (typeof entry.score === 'number' && entry.score !== v.score) throw Object.assign(new Error('score mismatch'), { status: 422 });
    return { score: v.score };
  }
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
  const keepFirst = entry.board === 'daily' || !!BOARDS[entry.board]?.firstOnly;
  if (!prev || (!keepFirst && score > prev.s)) {
    doc.scores[id] = { s: score, t: now, ...(entry.board === 'daily' || entry.board === 'deep' || entry.board === 'blocksDaily' ? { log: entry.log } : {}) };
  }
  let weekRank;
  const weekId = BOARDS[entry.board]?.arcade && !BOARDS[entry.board].daily ? `${entry.board}Week:${weekKey()}` : null;
  if (weekId && (!doc.scores[weekId] || score > doc.scores[weekId].s)) doc.scores[weekId] = { s: score, t: now };
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
  if (entry.board !== 'stars') leaguePoints(!prev || score > prev.s).catch(() => {});
  const board = await sharedTop(sh, entry.board, entry.board === 'stars' ? 'all' : entry.key);
  if (weekId) weekRank = (await sharedTop(sh, entry.board + 'Week', weekKey())).me?.rank;
  return { ok: true, rank: board.me?.rank, weekRank, best: doc.scores[id].s, verified: score };
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

// ---------------------------------------------------------------------------
// Weekly leagues. Server: /api/league. Shared-db: league/<uid> =
// { week, pts, name, division, day, runs, last } – grouped deterministically.
import * as League from './league.js';
import { weekKey as wk, dayKey as dk } from './modes.js';

export const league = {
  async get() {
    const sh = await sharedDb();
    if (sh) {
      const week = wk();
      const ref = sh.db.collection('league').doc(sh.uid);
      const snap = await ref.get();
      const mine = snap.exists ? snap.data() : {};
      await settleShared(ref, mine, week);
      const all = (await sh.db.collection('league').get()).docs.map((d) => ({ uid: d.id, ...(d.data() || {}) })).filter((m) => m.week === week && (m.division || 0) === (mine.division || 0) && m.pts > 0);
      const group = League.groupOf(sh.uid, all, week);
      return { week, division: mine.division || 0, joined: group.length > 0, last: mine.last || null, group: League.standings(group.map((m) => ({ name: String(m.name || 'Player').slice(0, 40), pts: Number(m.pts) || 0, at: m.at || 0, me: m.uid === sh.uid }))) };
    }
    return req('/league?' + new URLSearchParams({ playerId: load().playerId }).toString());
  },
  async claim() {
    const sh = await sharedDb();
    if (sh) {
      const ref = sh.db.collection('league').doc(sh.uid);
      const snap = await ref.get();
      const d = snap.exists ? snap.data() : {};
      if (!d.last || d.last.claimed) return { shells: 0 };
      d.last.claimed = true;
      await ref.set(d);
      return { shells: d.last.shells, result: d.last };
    }
    const p = await ensureRegistered();
    return req('/league/claim', { method: 'POST', body: JSON.stringify({ playerId: p.playerId, token: p.token }) });
  },
};

async function settleShared(ref, d, week) {
  if (d.week === week) return;
  if (d.week && d.pts > 0) {
    // last week's standing from everyone's docs (best effort)
    const sh = await sharedDb();
    const all = (await sh.db.collection('league').get()).docs.map((x) => ({ uid: x.id, ...(x.data() || {}) })).filter((m) => (m.week === d.week || m.lastWeek === d.week) && (m.division || 0) === (d.division || 0));
    const rows = all.map((m) => ({ uid: m.uid, pts: m.week === d.week ? m.pts : m.lastPts || 0, at: m.at || 0 })).filter((m) => m.pts > 0);
    const group = League.standings(League.groupOf(sh.uid, rows.length ? rows : [{ uid: sh.uid, pts: d.pts }], d.week));
    const rank = group.findIndex((m) => m.uid === sh.uid) + 1;
    const move = League.movement(rank, group.length, d.division || 0);
    d.last = { week: d.week, rank, size: group.length, division: d.division || 0, move, shells: League.weekReward(rank, group.length), claimed: false };
    d.division = Math.max(0, Math.min(League.DIVISIONS.length - 1, (d.division || 0) + move));
  }
  d.lastWeek = d.week; d.lastPts = d.pts || 0;
  d.week = week; d.pts = 0;
  await ref.set(d);
}

/** Shared-db only: add league points after a verified run (the server does this itself). */
export async function leaguePoints(improved) {
  const sh = await sharedDb();
  if (!sh) return;
  const ref = sh.db.collection('league').doc(sh.uid);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  await settleShared(ref, d, wk());
  const st = { day: d.day, runs: d.runs || 0 };
  const pts = League.pointsFor(st, dk(), improved);
  d.day = st.day; d.runs = st.runs;
  d.pts = (d.pts || 0) + pts;
  d.at = Date.now();
  d.name = load().name;
  await ref.set(d);
}

/** Anonymous usage count (no ids, no cookies). Server mode only; off if the player opted out. */
export function track(e, b = '-') {
  try {
    if (inArtifact() || load().settings.analytics === false) return;
    const body = JSON.stringify({ e, b: String(b).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16) || '-' });
    if (navigator.sendBeacon) navigator.sendBeacon(BASE + '/event', new Blob([body], { type: 'application/json' }));
    else fetch(BASE + '/event', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch { /* never let counting break the game */ }
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

let registering = null;
async function ensureRegistered() {
  const s = load();
  if (s.token) return s;
  // a single in-flight registration: parallel callers share it (two at once used to mint two ids)
  registering ||= req('/register', { method: 'POST', body: JSON.stringify({ playerId: s.playerId, name: s.name }) })
    .then((r) => { update((d) => { d.token = r.token; d.playerId = r.playerId; }); return load(); })
    .finally(() => { registering = null; });
  return registering;
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

/** Today's #1 run on a daily board (to race as a ghost): { name, score, log, me } or null. */
export async function ghost(board, key) {
  try {
    const sh = await sharedDb();
    if (sh) {
      const snap = await sh.db.collection('players').get();
      let best = null;
      snap.docs.forEach((d) => {
        const e = (d.data() || {}).scores?.[`${board}:${key}`];
        if (e && Array.isArray(e.log) && typeof e.s === 'number' && (!best || e.s > best.score)) best = { name: String(d.data().name || 'Top player').slice(0, 40), score: e.s, log: e.log, me: d.id === sh.uid };
      });
      return best;
    }
    if (inArtifact()) return null;
    return await req('/ghost?' + new URLSearchParams({ board, key, playerId: load().playerId }).toString());
  } catch { return null; }
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

// ---------------------------------------------------------------------------
// Online matches (Chess / Ludo). Each player writes only their own moves.
// Shared-db mode: entries live in the player's own `players/<id>` doc under
// `matches[CODE]`. Server mode: /api/match endpoints.
const MATCH_TTL = 7 * 86400000;

async function writeMine(sh, fn) {
  const ref = sh.db.collection('players').doc(sh.uid);
  const snap = await ref.get();
  const doc = snap.exists ? snap.data() : { scores: {}, levels: {} };
  doc.matches ||= {};
  fn(doc);
  const now = Date.now();
  for (const [k, m] of Object.entries(doc.matches)) if (!m || now - (m.at || 0) > MATCH_TTL) delete doc.matches[k];
  doc.name = load().name;
  doc.updatedAt = now;
  await ref.set(doc);
}

async function sharedFind(sh, code) {
  const snap = await sh.db.collection('players').get();
  let host = null;
  const guests = [];
  snap.docs.forEach((d) => {
    const m = d.data()?.matches?.[code];
    if (!m || Date.now() - (m.at || 0) > MATCH_TTL) return;
    const entry = { pid: d.id, name: String(d.data().name || 'Player').slice(0, 40), ...m };
    if (m.role === 'host') host = entry;
    else if (m.role === 'guest') guests.push(entry);
  });
  // first to join is "guest" (the host's partner), then guest2, guest3 – by join time
  guests.sort((a, b) => (a.joinedAt || a.at) - (b.joinedAt || b.at));
  const cap = host?.game === 'ludo' ? Math.max(2, Math.min(4, host.opts?.players || 2)) : 2;
  return { host, guest: guests[0] || null, extra: guests.slice(1, cap - 1) };
}
const ROLES = ['host', 'guest', 'guest2', 'guest3'];
const seatOfRole = (opts, role) => { const hs = opts?.hostColour || 0; return [hs, (hs + 2) % 4, (hs + 1) % 4, (hs + 3) % 4][ROLES.indexOf(role)]; };

function combine(host, guest, me, extra = []) {
  if (!host) return null;
  const sides = [['host', host], ['guest', guest], ...extra.map((x, i) => [ROLES[i + 2], x])].filter(([, x]) => x);
  return {
    ...(host.game === 'ludo' ? { seats: sides.map(([role, x]) => ({ role, seat: seatOfRole(host.opts, role), name: x.name, moves: x.moves || [], react: x.react || null })), players: host.opts?.players || 2, mySeat: me ? seatOfRole(host.opts, me) : null } : {}),
    code: host.code,
    game: host.game,
    seed: host.seed,
    opts: host.opts,
    hostName: host.name,
    guestName: guest?.name || null,
    hostMoves: host.moves || [],
    guestMoves: guest?.moves || [],
    joined: !!guest,
    resigned: host.resigned ? 'host' : guest?.resigned ? 'guest' : null,
    hostReact: host.react || null,
    guestReact: guest?.react || null,
    me,
  };
}

export const matches = {
  async available() {
    if (await sharedDb()) return true;
    if (inArtifact()) return false;
    return checkServer();
  },

  async create(code, game, seed, opts) {
    const sh = await sharedDb();
    if (sh) {
      await writeMine(sh, (doc) => { doc.matches[code] = { role: 'host', code, game, seed, opts, moves: [], at: Date.now() }; });
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'create', code, game, seed, opts, playerId: p.playerId, token: p.token }) });
  },

  async join(code) {
    const sh = await sharedDb();
    if (sh) {
      const { host, guest, extra } = await sharedFind(sh, code);
      if (!host) throw Object.assign(new Error('No match with that code'), { status: 404 });
      if (host.pid === sh.uid) throw Object.assign(new Error("That's your own match – share the code with a friend"), { status: 400 });
      const inIt = guest?.pid === sh.uid || extra.some((x) => x.pid === sh.uid);
      const cap = host.game === 'ludo' ? Math.max(2, Math.min(4, host.opts?.players || 2)) : 2;
      if (!inIt && 1 + (guest ? 1 : 0) + extra.length >= cap) throw Object.assign(new Error(cap === 2 ? 'That match already has two players' : 'That table is full'), { status: 409 });
      if (!inIt) await writeMine(sh, (doc) => { doc.matches[code] = { role: 'guest', code, game: host.game, seed: host.seed, opts: host.opts, moves: [], at: Date.now(), joinedAt: Date.now() }; });
      return this.get(code);
    }
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'join', code, playerId: p.playerId, token: p.token }) });
  },

  async get(code) {
    const sh = await sharedDb();
    if (sh) {
      const { host, guest, extra } = await sharedFind(sh, code);
      const xi = extra.findIndex((x) => x.pid === sh.uid);
      const me = host?.pid === sh.uid ? 'host' : guest?.pid === sh.uid ? 'guest' : xi >= 0 ? ROLES[xi + 2] : null;
      return combine(host, guest, me, extra);
    }
    const p = load();
    return req('/match?' + new URLSearchParams({ code, playerId: p.playerId }).toString());
  },

  async push(code, moves) {
    const sh = await sharedDb();
    if (sh) {
      await writeMine(sh, (doc) => { if (doc.matches[code]) { doc.matches[code].moves = moves; doc.matches[code].at = Date.now(); } });
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'move', code, moves, playerId: p.playerId, token: p.token }) });
  },

  async botify(code, seat) {
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'botify', code, seat, playerId: p.playerId, token: p.token }) });
  },

  async react(code, emoji) {
    const sh = await sharedDb();
    if (sh) { await writeMine(sh, (doc) => { if (doc.matches[code]) doc.matches[code].react = { e: emoji, at: Date.now() }; }); return { ok: true }; }
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'react', code, emoji, playerId: p.playerId, token: p.token }) });
  },

  async resign(code) {
    const sh = await sharedDb();
    if (sh) {
      await writeMine(sh, (doc) => { if (doc.matches[code]) doc.matches[code].resigned = true; });
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/match', { method: 'POST', body: JSON.stringify({ action: 'resign', code, playerId: p.playerId, token: p.token }) });
  },

  /** Poll a match; calls cb(match) when it changes. Returns a stop function. */
  watch(code, cb, ms = 2500, onPoll = null) {
    let last = '';
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const m = await this.get(code);
        const sig = JSON.stringify([m?.hostMoves, m?.guestMoves, m?.joined, m?.resigned, m?.hostReact, m?.guestReact, m?.seats, m?.botFrom]);
        if (sig !== last) { last = sig; cb(m); }
        onPoll?.(m); // every poll, even when nothing changed (a stalled table is exactly when nothing changes)
      } catch { /* offline – try again */ }
      if (!stopped) setTimeout(tick, document.hidden ? ms * 4 : ms);
    };
    tick();
    return () => { stopped = true; };
  },
};

// ---------------------------------------------------------------------------
// Community games (Creator Studio). Creations are plain data specs.
// Shared-db: games/<uid> = { name, creations: { id: record } } and
// ratings/<uid> = { r: {id: stars}, p: {id: plays}, rep: {id: true} }.
// Server: /api/ugc endpoints. Summaries look the same from both.
import { sanitize as ugcSanitize, replay as ugcReplay } from './maker/engine.js';

const UGC_ID = /^[a-z0-9]{8}$/;
export function newUgcId() {
  const c = 'abcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(8)) : Array.from({ length: 8 }, () => Math.random() * 1e9);
  return Array.from(buf, (n) => c[n % c.length]).join('');
}

function summarize(rec, ownerName, agg) {
  const v = rec.version;
  const spec = rec.specs[v];
  // fair ratings: only from people who played it and aren't the creator
  const rs = Object.entries(agg.r || {}).filter(([pid]) => pid !== agg.owner && agg.p?.[pid]).map(([, s]) => s);
  const reports = Object.entries(agg.rep || {}).filter(([pid, ver]) => pid !== agg.owner && (ver === true || ver === v) && agg.p?.[pid]).length;
  return {
    id: rec.id, version: v, title: spec.title, description: spec.description, template: spec.template, hero: spec.hero, palette: spec.palette,
    owner: ownerName, mine: !!agg.mine, createdAt: rec.createdAt, updatedAt: rec.updatedAt, history: rec.history || [],
    rating: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, ratings: rs.length,
    plays: Object.values(agg.p || {}).reduce((a, b) => a + b, 0), players: Object.keys(agg.p || {}).length,
    recentPlays: agg.recent || 0, reports, underReview: reports >= 3, remix: spec.remix || null, jam: spec.jam || null, myRating: agg.myRating || 0, mePlayed: !!agg.mePlayed,
  };
}

async function sharedUgcAll(sh) {
  const [games, ratings] = await Promise.all([sh.db.collection('games').get(), sh.db.collection('ratings').get()]);
  const agg = {};
  ratings.docs.forEach((d) => {
    const x = d.data() || {};
    for (const [id, s] of Object.entries(x.r || {})) if (s >= 1 && s <= 5) { ((agg[id] ||= { r: {}, p: {}, rep: {} }).r[d.id] = s); if (d.id === sh.uid) agg[id].myRating = s; }
    for (const [id, n] of Object.entries(x.p || {})) if (Number.isInteger(n) && n > 0 && n < 100000) { (agg[id] ||= { r: {}, p: {}, rep: {} }).p[d.id] = n; if (d.id === sh.uid) agg[id].mePlayed = true; }
    for (const [id, t] of Object.entries(x.pt || {})) if (Date.now() - t < 7 * 86400000) (agg[id] ||= { r: {}, p: {}, rep: {} }).recent = (agg[id].recent || 0) + 1;
    for (const [id, ver] of Object.entries(x.rep || {})) (agg[id] ||= { r: {}, p: {}, rep: {} }).rep[d.id] = ver;
  });
  const out = [];
  const all = {};
  games.docs.forEach((d) => { for (const rec of Object.values((d.data() || {}).creations || {})) if (rec?.id) all[rec.id] = { rec, owner: String((d.data() || {}).name || 'Creator').slice(0, 40) }; });
  games.docs.forEach((d) => {
    const x = d.data() || {};
    for (const rec of Object.values(x.creations || {})) {
      if (!rec || !UGC_ID.test(rec.id) || !rec.specs?.[rec.version]) continue;
      const a = agg[rec.id] || {};
      const g = summarize(rec, String(x.name || 'Creator').slice(0, 40), { ...a, owner: d.id, mine: d.id === sh.uid });
      // credit comes from the original's own record; unknown originals and old jam tags are dropped
      const orig = g.remix && all[g.remix.id];
      g.remix = orig && g.remix.id !== rec.id ? { id: g.remix.id, title: orig.rec.specs?.[orig.rec.version]?.title || 'a game', owner: orig.owner } : null;
      if (g.jam && g.jam !== weekKey(new Date(rec.updatedAt || Date.now()))) g.jam = null;
      if (g.underReview && rec.clearedVersion === rec.version) g.underReview = false;
      g.remixes = Object.values(all).filter((o) => o.rec.specs?.[o.rec.version]?.remix?.id === rec.id).length;
      out.push({ ...g, _rec: rec });
    }
  });
  return out;
}

async function myRatingsDoc(sh, fn) {
  const ref = sh.db.collection('ratings').doc(sh.uid);
  const snap = await ref.get();
  const doc = snap.exists ? snap.data() : {};
  doc.r ||= {}; doc.p ||= {}; doc.pt ||= {}; doc.rep ||= {};
  fn(doc);
  await ref.set(doc);
}

export const ugc = {
  async available() {
    if (await sharedDb()) return true;
    if (inArtifact()) return false;
    return checkServer();
  },

  /** List published games (hidden ones filtered unless they're mine). */
  async list() {
    const sh = await sharedDb();
    if (sh) return (await sharedUgcAll(sh)).filter((g) => !g.underReview || g.mine).map(({ _rec, ...g }) => g);
    const p = load();
    return (await req('/ugc?' + new URLSearchParams({ playerId: p.playerId }).toString())).games;
  },

  /** Full record incl. the spec for a given (or current) version. */
  async get(id) {
    const sh = await sharedDb();
    if (sh) {
      const g = (await sharedUgcAll(sh)).find((x) => x.id === id);
      if (!g) throw Object.assign(new Error('That game was removed'), { status: 404 });
      return { ...g, specs: g._rec.specs, spec: g._rec.specs[g.version], _rec: undefined };
    }
    const p = load();
    return req('/ugc?' + new URLSearchParams({ id, playerId: p.playerId }).toString());
  },

  async publish(id, spec, note) {
    const clean = ugcSanitize(spec);
    const n = String(note || '').slice(0, 120);
    const sh = await sharedDb();
    if (sh) {
      const ref = sh.db.collection('games').doc(sh.uid);
      const snap = await ref.get();
      const doc = snap.exists ? snap.data() : {};
      doc.creations ||= {};
      if (!doc.creations[id] && Object.keys(doc.creations).length >= 20) throw Object.assign(new Error('You can publish up to 20 games'), { status: 400 });
      const now = Date.now();
      const rec = doc.creations[id] || { id, version: 0, specs: {}, history: [], createdAt: now };
      rec.version++;
      rec.specs[rec.version] = clean;
      // keep the last 10 versions' rules (older leaderboards stay verifiable)
      for (const v of Object.keys(rec.specs)) if (Number(v) <= rec.version - 10) delete rec.specs[v];
      rec.history = [...rec.history, { v: rec.version, at: now, note: n || (rec.version === 1 ? 'First release' : 'Updated') }].slice(-20);
      rec.updatedAt = now;
      doc.creations[id] = rec;
      doc.name = load().name;
      await ref.set(doc);
      return { ok: true, version: rec.version };
    }
    const p = await ensureRegistered();
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'publish', id, spec: clean, note: n, playerId: p.playerId, token: p.token }) });
  },

  async remove(id) {
    const sh = await sharedDb();
    if (sh) {
      const ref = sh.db.collection('games').doc(sh.uid);
      const snap = await ref.get();
      if (!snap.exists) return { ok: true };
      const doc = snap.data();
      delete doc.creations?.[id];
      await ref.set(doc);
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'delete', id, playerId: p.playerId, token: p.token }) });
  },

  async rate(id, stars) {
    const s = Math.max(1, Math.min(5, Math.round(stars)));
    const sh = await sharedDb();
    if (sh) { await myRatingsDoc(sh, (d) => { d.r[id] = s; }); return { ok: true }; }
    const p = await ensureRegistered();
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'rate', id, stars: s, playerId: p.playerId, token: p.token }) });
  },

  /** A finished play; with { seed, log, version } the server replays it so you may rate/report. */
  async played(id, run = {}) {
    const sh = await sharedDb();
    if (sh) { await myRatingsDoc(sh, (d) => { d.p[id] = (d.p[id] || 0) + 1; d.pt[id] = Date.now(); }); return { ok: true }; }
    const p = await ensureRegistered();
    if (run.log) return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'play', id, seed: run.seed, log: run.log, version: run.version, playerId: p.playerId, token: p.token }) });
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'play', id, playerId: p.playerId, token: p.token }) });
  },

  async report(id) {
    const sh = await sharedDb();
    if (sh) {
      const g = (await sharedUgcAll(sh)).find((x) => x.id === id);
      await myRatingsDoc(sh, (d) => { d.rep[id] = g?.version || true; });
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'report', id, playerId: p.playerId, token: p.token }) });
  },

  /** Can this viewer moderate? (claude.ai: the artifact's owner) */
  async canModerate() {
    const sh = await sharedDb();
    try { return !!(sh && (await sh.user?.isOwner?.())); } catch { return false; }
  },
  /** Games held for review (moderators only, claude.ai shared db). */
  async held() {
    const sh = await sharedDb();
    if (!sh) return [];
    return (await sharedUgcAll(sh)).filter((g) => g.underReview).map(({ _rec, ...g }) => ({ ...g, appeal: _rec.appeal || null }));
  },
  async moderate(id, decision) {
    const sh = await sharedDb();
    if (!sh) throw new Error('Moderation runs on the server');
    const snap = await sh.db.collection('games').get();
    for (const d of snap.docs) {
      const doc = d.data() || {};
      const rec = doc.creations?.[id];
      if (!rec) continue;
      if (decision === 'remove') delete doc.creations[id];
      else rec.clearedVersion = rec.version;
      await sh.db.collection('games').doc(d.id).set(doc);
      return { ok: true };
    }
    throw new Error('That game was removed');
  },
  /** The creator asks a moderator to look again. */
  async appeal(id, note) {
    const sh = await sharedDb();
    const text = String(note || '').slice(0, 200);
    if (sh) {
      const ref = sh.db.collection('games').doc(sh.uid);
      const snap = await ref.get();
      const doc = snap.exists ? snap.data() : {};
      if (!doc.creations?.[id]) throw new Error('Not your game');
      doc.creations[id].appeal = { note: text, at: Date.now() };
      await ref.set(doc);
      return { ok: true };
    }
    const p = await ensureRegistered();
    return req('/ugc', { method: 'POST', body: JSON.stringify({ action: 'appeal', id, note: text, playerId: p.playerId, token: p.token }) });
  },

  /** Submit a run: verified by replaying with that version's rules. */
  async submit(game, version, seed, log) {
    const key = `${game.id}-${version}`;
    const sh = await sharedDb();
    if (sh) {
      const r = ugcReplay(game.specs[version], seed, log);
      if (!r.ok) throw Object.assign(new Error('replay failed'), { status: 422 });
      const ref = sh.db.collection('players').doc(sh.uid);
      const snap = await ref.get();
      const doc = snap.exists ? snap.data() : { scores: {}, levels: {} };
      doc.scores ||= {};
      const id = `ugc:${key}`;
      if (!doc.scores[id] || r.sim.score > doc.scores[id].s) doc.scores[id] = { s: r.sim.score, t: Date.now() };
      doc.name = load().name;
      await ref.set(doc);
      const top = await sharedTop(sh, 'ugc', key);
      return { ok: true, rank: top.me?.rank, verified: r.sim.score };
    }
    const p = await ensureRegistered();
    return req('/scores', { method: 'POST', body: JSON.stringify({ board: 'ugc', key, seed, log, v: (await import('./modes.js')).ENGINE_VERSION, playerId: p.playerId, token: p.token }) });
  },
};

// ---------------------------------------------------------------------------
// Accounts & cloud save (see cloud.js). On a Tidepop server: username +
// password accounts. Inside the claude.ai artifact: the viewer's Claude
// account, with the save in a private per-person document.

/** Is a Tidepop server (with accounts) reachable from here? */
export async function accountsAvailable() {
  if (inArtifact()) return false;
  try {
    await req('/health', {}, 4000);
    return true;
  } catch {
    return false;
  }
}

export function accountCall(op, body = {}, timeout = 12000) {
  return req('/account/' + op, { method: 'POST', body: JSON.stringify(body) }, timeout);
}

/** Private save document for the signed-in Claude user (artifact only). */
export async function claudeSaveDoc() {
  const sh = await sharedDb();
  if (!sh) return null;
  return sh.db.doc(`data/users/${sh.uid}/save`);
}

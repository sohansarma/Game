// Registry of arcade games. Each game module is a PURE, deterministic
// simulation (no DOM): `create(seed)` makes a run, every player action goes
// into `sim.log`, and `replay(seed, log)` rebuilds the run. The server and
// the shared leaderboard both call verifyArcade() to re-score a submission.
//
// Each game gets two leaderboards: `<id>` (all-time best, any seed) and
// `<id>Daily` (today's seed, the same for everyone; best of the day).

import { hashString } from '../rng.js';
import miner from './miner.js';
import puffer from './puffer.js';
import serpent from './serpent.js';
import merge from './merge.js';
import stack from './stack.js';
import sort from './sort.js';
import breaker from './breaker.js';
import crabCatch from './catch.js';
import chess from './chess.js';
import ludo from './ludo.js';
import cube, { scrambleGame } from './cube.js';
import tide from './tide.js';

export const ARCADE = [chess, ludo, cube, miner, puffer, serpent, merge, stack, sort, breaker, crabCatch, tide, scrambleGame];

export const ARCADE_BY_ID = Object.fromEntries(ARCADE.map((g) => [g.id, g]));

/** Leaderboard definitions merged into modes.BOARDS. */
export function arcadeBoards() {
  const out = {};
  for (const g of ARCADE) {
    out[g.id] = { title: g.title, game: g.id, period: 'all', arcade: g.id, daily: false };
    out[g.id + 'Daily'] = { title: `${g.title} Daily`, game: g.id, period: 'day', arcade: g.id, daily: true, firstOnly: !!g.firstTry };
    out[g.id + 'Week'] = { title: `${g.title} Weekly`, game: g.id, period: 'week', arcade: g.id, weekly: true };
  }
  return out;
}

export function gameForBoard(board) {
  return ARCADE_BY_ID[board.replace(/(Daily|Week)$/, '')] || null;
}

export function arcadeSeed(gameId, daily, key, runSeed) {
  return daily ? hashString(`tidepop-${gameId}-daily-${key}`) : runSeed >>> 0;
}

/** Re-run a submission. Returns { ok, score, reason }. */
export function verifyArcade(board, key, seed, log) {
  const game = gameForBoard(board);
  if (!game) return { ok: false, reason: 'unknown game' };
  if (!Array.isArray(log) || log.length > game.maxLog) return { ok: false, reason: 'bad log' };
  const daily = board.endsWith('Daily');
  if (!daily && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) return { ok: false, reason: 'bad seed' };
  let r;
  try {
    r = game.replay(arcadeSeed(game.id, daily, key, seed), log);
  } catch {
    return { ok: false, reason: 'replay crashed' };
  }
  if (!r.ok) return { ok: false, reason: r.reason || 'invalid run' };
  if (!r.sim.over) return { ok: false, reason: 'game not finished' };
  return { ok: true, score: r.sim.score };
}

// Per-game rank tiers from your best score, relative to the game's milestone.
export const TIERS = [
  { name: 'Bronze', icon: '🥉', at: 0.1 },
  { name: 'Silver', icon: '🥈', at: 0.3 },
  { name: 'Gold', icon: '🥇', at: 0.6 },
  { name: 'Platinum', icon: '💠', at: 1 },
  { name: 'Diamond', icon: '💎', at: 2 },
  { name: 'Legend', icon: '👑', at: 4 },
];
export function tierOf(game, best) {
  let tier = null, next = TIERS[0];
  for (const t of TIERS) {
    if (best >= Math.round(game.milestone * t.at)) { tier = t; next = TIERS[TIERS.indexOf(t) + 1] || null; }
  }
  return { tier, next, nextAt: next ? Math.round(game.milestone * next.at) : null };
}

// Challenge links: #ch-<game>-<seed36>-<score36>-<adjIdx>-<animalIdx>-<num>
const b64u = {
  enc: (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

/** Challenge link fragment. The sender's name travels as base64url text ("n.<name>"). */
export function challengeHash(gameId, seed, score, name) {
  const who = Array.isArray(name) ? name.join('-') : `n.${b64u.enc(String(name).slice(0, 20))}`;
  return `ch-${gameId}-${(seed >>> 0).toString(36)}-${Math.max(0, score).toString(36)}-${who}`;
}
/** name is a string (new links) or [adjective, animal, number] indexes (older links). */
export function parseChallenge(hash) {
  const m = /^#?ch-([a-z]+)-([0-9a-z]{1,7})-([0-9a-z]{1,9})-(?:(\d{1,2})-(\d{1,2})-(\d{2})|n\.([A-Za-z0-9_-]{1,64}))$/.exec(hash || '');
  if (!m || !ARCADE_BY_ID[m[1]]) return null;
  const seed = parseInt(m[2], 36), score = parseInt(m[3], 36);
  if (!(seed >= 0 && seed <= 0xffffffff) || !(score >= 0)) return null;
  if (m[7]) {
    let name = null;
    try { name = b64u.dec(m[7]); } catch { /* bad link */ }
    return { game: m[1], seed, score, name: typeof name === 'string' ? name : '' };
  }
  return { game: m[1], seed, score, name: [Number(m[4]), Number(m[5]), Number(m[6])] };
}

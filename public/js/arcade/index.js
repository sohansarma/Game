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

export const ARCADE = [chess, ludo, miner, puffer, serpent, merge, stack, sort, breaker, crabCatch];

export const ARCADE_BY_ID = Object.fromEntries(ARCADE.map((g) => [g.id, g]));

/** Leaderboard definitions merged into modes.BOARDS. */
export function arcadeBoards() {
  const out = {};
  for (const g of ARCADE) {
    out[g.id] = { title: g.title, game: g.id, period: 'all', arcade: g.id, daily: false };
    out[g.id + 'Daily'] = { title: `${g.title} Daily`, game: g.id, period: 'day', arcade: g.id, daily: true };
  }
  return out;
}

export function gameForBoard(board) {
  return ARCADE_BY_ID[board.endsWith('Daily') ? board.slice(0, -5) : board] || null;
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

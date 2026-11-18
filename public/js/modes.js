// Shared definitions of the ranked modes. Imported by both the browser and
// the server so a board key ("2026-11-17") always produces the same game.

import { hashString, Rng } from './rng.js';
import { arcadeBoards } from './arcade/index.js';

export const BOARDS = {
  daily: { title: 'Daily Dive', game: 'match', period: 'day' },
  deep: { title: 'Deep Dive', game: 'match', period: 'week' },
  blocksDaily: { title: 'Reef Blocks Daily', game: 'blocks', period: 'day' },
  blocks: { title: 'Reef Blocks', game: 'blocks', period: 'all' },
  stars: { title: 'Adventure Stars', game: 'stars', period: 'all' },
  ...arcadeBoards(),
  ugc: { title: 'Community game', game: 'ugc', period: 'all', ugc: true },
};

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ISO week, e.g. "2026-W47"
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(board, date = new Date()) {
  const p = BOARDS[board].period;
  return p === 'day' ? dayKey(date) : p === 'week' ? weekKey(date) : 'all';
}

/** Keys a submission may target right now (current + previous, for midnight grace). */
export function acceptableKeys(board, now = new Date()) {
  const p = BOARDS[board].period;
  if (p === 'all') return ['all'];
  const prev = new Date(now.getTime() - (p === 'day' ? 2 : 2) * 3600 * 1000); // 2h grace
  return [...new Set([periodKey(board, now), periodKey(board, prev)])];
}

function sprinkle(rng, size, chance, value) {
  const out = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (rng.next() < chance) out.push([r, c, value]);
  return out;
}

export function dailyConfig(key) {
  const seed = hashString('tidepop-daily-' + key);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const size = 9;
  return {
    mode: 'daily',
    board: 'daily',
    key,
    rows: size,
    cols: size,
    colors: 5,
    moves: 25,
    seed,
    holes: rng.next() < 0.5 ? [[0, 0], [0, 8], [8, 0], [8, 8]] : [],
    jelly: sprinkle(rng, size, 0.25, 1),
    crates: [],
    objectives: [],
    stars: [0, 0, 0],
  };
}

export function deepConfig(key) {
  const seed = hashString('tidepop-deep-' + key);
  return {
    mode: 'endless',
    board: 'deep',
    key,
    rows: 9,
    cols: 9,
    colors: 6,
    moves: 20,
    seed,
    holes: [],
    jelly: [],
    crates: [],
    objectives: [],
    stars: [0, 0, 0],
    bonusMoves: true,
  };
}

export function blocksSeed(board, key, runSeed) {
  return board === 'blocksDaily' ? hashString('tidepop-blocks-' + key) : runSeed >>> 0;
}

// Bump when engine rules change in a way that alters replays. The server
// rejects submissions from a different version (client is told to update).
export const ENGINE_VERSION = 5; // 2: Starfish special · 3: fair block trays · 4: arcade feel pass (tower zones, crab beat, sort hints) · 5: crates trap (diagonal refill)

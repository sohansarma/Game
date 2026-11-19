// Tide of the Day – one shared flood puzzle a day (the same for everyone).
// A 10x10 grid of sea colours; the tide starts in the top-left corner. Each
// move picks a colour: the tide turns that colour and swallows every touching
// tile of it. Fill the whole board within the move limit. A solver sets par.
// One ranked attempt per day; the result shares as an emoji grid.
// Pure & deterministic: create(seed) / replay(seed, log) like every arcade game.

import { Rng } from '../rng.js';

export const N = 10;
export const COLORS = 6;
export const PALETTE = ['#3fa9f5', '#3fcf8e', '#ffd166', '#ef6f6c', '#a07cf0', '#ff9f43'];
export const SYMBOLS = ['●', '▲', '■', '◆', '★', '♥']; // colour-blind friendly
export const EMOJI = ['🟦', '🟩', '🟨', '🟥', '🟪', '🟧'];
const EPOCH = Date.UTC(2026, 10, 18); // Tide #1 = 2026-11-18

/** The tide's number for a day key (YYYY-MM-DD, UTC like the other dailies). */
export function tideNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) + 1;
}

export function makeGrid(seed) {
  const rng = new Rng(seed);
  const g = [];
  for (let i = 0; i < N * N; i++) {
    let c = rng.int(COLORS);
    // gentle clumping so it looks like water, not static
    const r = Math.floor(i / N), col = i % N;
    if (col > 0 && rng.next() < 0.22) c = g[i - 1];
    else if (r > 0 && rng.next() < 0.22) c = g[i - N];
    g.push(c);
  }
  return g;
}

/** Cells connected to the corner through the corner's colour. */
export function region(g) {
  const c = g[0];
  const seen = new Uint8Array(N * N);
  const stack = [0];
  seen[0] = 1;
  const out = [];
  while (stack.length) {
    const i = stack.pop();
    out.push(i);
    const r = Math.floor(i / N), col = i % N;
    for (const j of [col > 0 ? i - 1 : -1, col < N - 1 ? i + 1 : -1, r > 0 ? i - N : -1, r < N - 1 ? i + N : -1]) {
      if (j >= 0 && !seen[j] && g[j] === c) { seen[j] = 1; stack.push(j); }
    }
  }
  return out;
}

export function flood(g, c) {
  const next = g.slice();
  for (const i of region(g)) next[i] = c;
  return next;
}

/** Greedy solver with two-move lookahead → par. */
export function solve(start, maxMoves = 60) {
  let g = start.slice();
  const moves = [];
  while (region(g).length < N * N && moves.length < maxMoves) {
    let best = -1, bestV = -1;
    for (let c = 0; c < COLORS; c++) {
      if (c === g[0]) continue;
      const a = flood(g, c);
      const now = region(a).length;
      let v = now * 1000; // the immediate gain always outweighs the lookahead
      if (now === N * N) v = 1e9;
      else {
        let look = 0;
        for (let d = 0; d < COLORS; d++) if (d !== c) look = Math.max(look, region(flood(a, d)).length);
        v += look;
      }
      if (v > bestV) { bestV = v; best = c; }
    }
    g = flood(g, best);
    moves.push(best);
  }
  return moves;
}

/**
 * Beam search for (near-)optimal solutions: keeps the best `width` positions
 * per depth, scored by tide size minus colours still left on the board.
 * Width 200 finds the best known line on ~all days in ~100 ms.
 */
export function bestSolve(start, width = 200) {
  let beam = [{ g: start, moves: [] }];
  for (let depth = 0; depth < 40; depth++) {
    const next = [];
    const seen = new Set();
    for (const s of beam) {
      for (let c = 0; c < COLORS; c++) {
        if (c === s.g[0]) continue;
        const g = flood(s.g, c);
        const reg = region(g);
        if (reg.length === N * N) return [...s.moves, c];
        const key = g.join('');
        if (seen.has(key)) continue;
        seen.add(key);
        const inTide = new Uint8Array(N * N);
        for (const i of reg) inTide[i] = 1;
        const left = new Set();
        for (let i = 0; i < N * N; i++) if (!inTide[i]) left.add(g[i]);
        next.push({ g, moves: [...s.moves, c], score: reg.length - left.size * 6 });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, width);
  }
  return solve(start);
}

class TideSim {
  /** hard: the limit is the perfect line itself – no spare moves at all */
  constructor(seed, hard = false) {
    this.seed = seed >>> 0;
    this.grid = makeGrid(this.seed);
    this.start = this.grid.slice();
    // perfect = best known solution; par = perfect + 1; limit = perfect + 3
    // (a careful player wins ~93% of days, a sloppy one ~66%)
    this.perfect = bestSolve(this.grid).length;
    this.par = this.perfect + 1;
    this.limit = hard ? this.perfect : this.perfect + 3;
    this.hard = hard;
    this.gains = [];
    this.moves = [];
    this.log = [];
    this.over = false;
    this.solved = false;
    this.overReason = '';
  }

  get covered() {
    return region(this.grid).length;
  }

  /** Solved: 1000 + 100 per move left (beating par shows). Not solved: tiles flooded. */
  get score() {
    if (this.solved) return 1000 + (this.limit - this.moves.length) * 100 + (this.moves.length <= this.perfect ? 250 : 0);
    return this.over ? this.covered : 0;
  }

  pick(c) {
    if (this.over || !Number.isInteger(c) || c < 0 || c >= COLORS || c === this.grid[0]) return { ok: false };
    const before = this.covered;
    this.grid = flood(this.grid, c);
    this.moves.push(c);
    this.log.push(c);
    const gained = this.covered - before;
    this.gains.push(gained);
    if (this.covered === N * N) { this.over = true; this.solved = true; this.overReason = 'Tide in!'; }
    else if (this.moves.length >= this.limit) { this.over = true; this.overReason = 'Out of moves'; }
    return { ok: true, gained };
  }

  quit() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
    this.overReason = 'Gave up';
  }
}

function replay(seed, log) {
  const sim = new TideSim(seed);
  for (const a of log) {
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    let r;
    if (typeof a === 'number') r = sim.pick(a);
    else if (Array.isArray(a) && a[0] === 'q') { sim.quit(); r = { ok: true }; }
    else return { ok: false, reason: 'unknown action', sim };
    if (!r.ok) return { ok: false, reason: 'invalid action', sim };
  }
  return { ok: true, sim };
}

/** "Tidepop Tide #12 🌊 15/21 …" with the colours you picked. */
/** One square per move showing how much it flooded – never the colours, so it can't spoil the puzzle. */
export function moveSquare(gain) {
  return gain <= 0 ? '⬛' : gain < 6 ? '🟦' : gain < 14 ? '🟩' : '🌊';
}

/** "Tidepop Tide #12 🌊 12/15 💎 …" – spoiler-free. */
export function shareText(key, sim, extra = '') {
  const res = sim.solved ? `${sim.moves.length}/${sim.limit}` : `X/${sim.limit}`;
  const badge = !sim.solved ? `🌫️ ${sim.covered}% flooded` : sim.moves.length <= sim.perfect ? '💎 perfect!' : sim.moves.length <= sim.par ? '⛳ par' : `par ${sim.par}`;
  const gains = sim.gains || [];
  const rows = [];
  for (let i = 0; i < gains.length; i += 8) rows.push(gains.slice(i, i + 8).map(moveSquare).join(''));
  return `Tidepop Tide #${tideNumber(key)} ${res} ${badge}\n${rows.join('\n')}\n(🌊 huge · 🟩 good · 🟦 small · ⬛ none)${extra ? '\n' + extra : ''}`;
}

export default {
  id: 'tide',
  title: 'Tide of the Day',
  icon: '🌊',
  tagline: 'One shared puzzle a day – flood the board in as few moves as you can',
  color: ['#4fc3f7', '#0d47a1'],
  maxLog: 80,
  shellsPer: 100,
  milestone: 1500,
  special: true, // not in the endless-game grid, hot-game rotation or weekly tournaments
  firstTry: true, // the daily board ranks only your first attempt
  create: (seed) => new TideSim(seed),
  replay,
};
export { TideSim };

/** The day key (YYYY-MM-DD) of Tide #n. */
export function tideKey(n) {
  return new Date(EPOCH + (n - 1) * 86400000).toISOString().slice(0, 10);
}
/** Hard tide: a different board the same day, and you must find the perfect line. */
export const hardSeed = (seed) => (seed ^ 0x5bd1e995) >>> 0;

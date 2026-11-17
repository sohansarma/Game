// Shell Merge – a 2048-style sliding merge game. Pure & deterministic:
// new tiles come from a seeded RNG, inputs are swipe directions.
// Score = sum of merged tile values (classic 2048 scoring).

import { Rng } from '../rng.js';

export const N = 4;
export const LADDER = ['🐚', '🦐', '🦀', '🐠', '🐡', '🐢', '🐙', '🦈', '🐬', '🐳', '👑', '🌊', '🌟', '💎', '🪐', '🌌'];
export const tileEmoji = (v) => LADDER[Math.min(LADDER.length - 1, Math.log2(v) - 1)];

class MergeSim {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.grid = Array.from({ length: N }, () => new Array(N).fill(null));
    this.nextId = 1;
    this.score = 0;
    this.moves = 0;
    this.best = 2;
    this.over = false;
    this.overReason = '';
    this.log = [];
    this.spawn();
    this.spawn();
  }

  spawn() {
    const free = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.grid[r][c]) free.push([r, c]);
    if (!free.length) return null;
    const [r, c] = this.rng.pick(free);
    const t = { id: this.nextId++, v: this.rng.next() < 0.9 ? 2 : 4 };
    this.grid[r][c] = t;
    return { ...t, r, c };
  }

  /** dir: 'u' | 'd' | 'l' | 'r'. Returns { ok, moves:[{id,fr,fc,r,c}], merges:[{id,r,c,v}], spawned } */
  move(dir) {
    if (this.over) return { ok: false };
    const vec = { u: [-1, 0], d: [1, 0], l: [0, -1], r: [0, 1] }[dir];
    if (!vec) return { ok: false };
    const moves = [], merges = [];
    let moved = false;
    const lines = [];
    for (let i = 0; i < N; i++) {
      const cells = [];
      for (let j = 0; j < N; j++) {
        // walk from the edge we slide toward
        const k = vec[0] + vec[1] > 0 ? N - 1 - j : j;
        cells.push(vec[0] !== 0 ? [k, i] : [i, k]);
      }
      lines.push(cells);
    }
    const next = Array.from({ length: N }, () => new Array(N).fill(null));
    for (const cells of lines) {
      let w = 0;
      let lastMergeable = null; // { tile, pos }
      for (const [r, c] of cells) {
        const t = this.grid[r][c];
        if (!t) continue;
        if (lastMergeable && lastMergeable.tile.v === t.v) {
          const [tr, tc] = lastMergeable.pos;
          const merged = { id: this.nextId++, v: t.v * 2 };
          next[tr][tc] = merged;
          moves.push({ id: t.id, fr: r, fc: c, r: tr, c: tc, gone: true });
          merges.push({ id: merged.id, from: [lastMergeable.tile.id, t.id], r: tr, c: tc, v: merged.v });
          this.score += merged.v;
          this.best = Math.max(this.best, merged.v);
          lastMergeable = null;
          moved = true;
        } else {
          const [tr, tc] = cells[w++];
          next[tr][tc] = t;
          if (tr !== r || tc !== c) moved = true;
          moves.push({ id: t.id, fr: r, fc: c, r: tr, c: tc });
          lastMergeable = { tile: t, pos: [tr, tc] };
        }
      }
    }
    if (!moved) return { ok: false };
    this.log.push(['m', dir]);
    this.grid = next;
    this.moves++;
    const spawned = this.spawn();
    if (!this.canMove()) {
      this.over = true;
      this.overReason = this.best >= 2048 ? 'Ocean master! 👑' : 'No more moves!';
    }
    return { ok: true, moves, merges, spawned };
  }

  canMove() {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const t = this.grid[r][c];
        if (!t) return true;
        if (c + 1 < N && this.grid[r][c + 1]?.v === t.v) return true;
        if (r + 1 < N && this.grid[r + 1][c]?.v === t.v) return true;
      }
    return false;
  }

  quit() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
    this.overReason = 'Cashed out';
  }
}

function replay(seed, log) {
  const sim = new MergeSim(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    if (a[0] === 'm') { if (!sim.move(a[1]).ok) return { ok: false, reason: 'invalid move', sim }; }
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'merge',
  title: 'Shell Merge',
  icon: '🐳',
  tagline: 'Slide & merge shells into a whale',
  color: ['#9575cd', '#311b92'],
  maxLog: 20000,
  shellsPer: 250,
  milestone: 10000,
  create: (seed) => new MergeSim(seed),
  replay,
};
export { MergeSim };

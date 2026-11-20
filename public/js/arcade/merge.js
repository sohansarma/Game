// Shell Merge – a 2048-style sliding merge game. Pure & deterministic:
// new tiles come from a seeded RNG, inputs are swipe directions.
// Score = sum of merged tile values (classic 2048 scoring), plus a combo
// bonus when one swipe makes several merges (+25% per extra merge).
// The next creature is shown in advance. Making a new top tile of 128 or
// more earns an undo (hold up to 2); ['u'] rewinds one move.
// Creature powers, when they are made by a merge: 🐙 (128) squirts ink and
// clears the smallest tile next to it; 🦈 (256) eats every 🐚 2 next to it
// (+2 each).

import { Rng } from '../rng.js';

export const N = 4;
export const LADDER = ['🐚', '🦐', '🦀', '🐠', '🐡', '🐢', '🐙', '🦈', '🐬', '🐳', '👑', '🌊', '🌟', '💎', '🪐', '🌌'];
export const tileEmoji = (v) => LADDER[Math.min(LADDER.length - 1, Math.log2(v) - 1)];

class MergeSim {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.vrng = new Rng((seed ^ 0x9e3779b9) >>> 0); // values, separate so we can preview
    this.nextV = this.vrng.next() < 0.9 ? 2 : 4;
    this.undos = 0;
    this.snap = null;
    this.lastCombo = 0;
    this.grid = Array.from({ length: N }, () => new Array(N).fill(null));
    this.nextId = 1;
    this.score = 0;
    this.moves = 0;
    this.best = 2;
    this.over = false;
    this.overReason = '';
    this.revived = false; // one revive per run (a rewarded ad in the Android app)
    this.log = [];
    this.spawn();
    this.spawn();
  }

  spawn() {
    const free = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.grid[r][c]) free.push([r, c]);
    if (!free.length) return null;
    const [r, c] = this.rng.pick(free);
    const t = { id: this.nextId++, v: this.nextV };
    this.nextV = this.vrng.next() < 0.9 ? 2 : 4;
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
    const snap = { grid: this.grid.map((row) => row.map((t) => (t ? { ...t } : null))), score: this.score, moves: this.moves, best: this.best, s: this.rng.s, vs: this.vrng.s, nextV: this.nextV, nextId: this.nextId };
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
    if (!moved) { this.score = snap.score; this.best = snap.best; return { ok: false }; }
    this.log.push(['m', dir]);
    this.snap = snap;
    // creature powers fire where they were made
    const powers = [];
    const nbrs = (r, c) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N);
    for (const m of merges) {
      if (m.v === 128) {
        let best = null;
        for (const [a, b] of nbrs(m.r, m.c)) { const t = next[a][b]; if (t && t.v < 128 && (!best || t.v < next[best[0]][best[1]].v)) best = [a, b]; }
        if (best) { powers.push({ kind: 'ink', r: best[0], c: best[1], id: next[best[0]][best[1]].id, from: [m.r, m.c] }); next[best[0]][best[1]] = null; }
      } else if (m.v === 256) {
        for (const [a, b] of nbrs(m.r, m.c)) if (next[a][b]?.v === 2) { powers.push({ kind: 'eat', r: a, c: b, id: next[a][b].id, from: [m.r, m.c] }); next[a][b] = null; this.score += 2; }
      }
    }
    // several merges in one swipe: combo bonus
    let bonus = 0;
    if (merges.length >= 2) bonus = Math.round(merges.reduce((a, m) => a + m.v, 0) * 0.25 * (merges.length - 1));
    this.score += bonus;
    this.lastCombo = merges.length;
    // a new top creature (128+) earns an undo
    let earned = false;
    if (this.best > snap.best && this.best >= 128 && this.undos < 2) { this.undos++; earned = true; }
    this.grid = next;
    this.moves++;
    const spawned = this.spawn();
    if (!this.canMove()) {
      this.over = true;
      this.overReason = this.best >= 2048 ? 'Ocean master! 👑' : 'No more moves!';
    }
    return { ok: true, moves, merges, spawned, bonus, earned, powers };
  }

  /** Rewind the last move (costs one earned undo). */
  undo() {
    if (this.over || !this.snap || this.undos <= 0) return false;
    const p = this.snap;
    this.log.push(['u']);
    this.grid = p.grid; this.score = p.score; this.moves = p.moves; this.best = p.best;
    this.rng.s = p.s; this.vrng.s = p.vs; this.nextV = p.nextV; this.nextId = p.nextId;
    this.undos--;
    this.snap = null;
    return true;
  }

  /** Out of moves (not cashed out, not the 2048 win) and not revived yet. */
  canRevive() {
    return this.over && !this.revived && this.overReason === 'No more moves!';
  }

  /**
   * Revive: the six smallest shells are taken off the board (ties: top-left first) and play goes on.
   * Deterministic ('r' in the log), so the server replays it exactly.
   */
  revive() {
    if (!this.canRevive()) return false;
    this.log.push(['r']);
    const all = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.grid[r][c]) all.push([r, c, this.grid[r][c].v]);
    all.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    for (const [r, c] of all.slice(0, 6)) this.grid[r][c] = null;
    this.revived = true;
    this.over = false;
    this.overReason = '';
    this.snap = null;
    return true;
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

function replay(seed, log, opts = {}) {
  const sim = new MergeSim(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (a[0] === 'r') { if (opts.noRevive || !sim.revive()) return { ok: false, reason: 'invalid revive', sim }; continue; } // the only action allowed after game over
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    if (a[0] === 'm') { if (!sim.move(a[1]).ok) return { ok: false, reason: 'invalid move', sim }; }
    else if (a[0] === 'u') { if (!sim.undo()) return { ok: false, reason: 'invalid undo', sim }; }
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

// Core match-3 simulation. Pure & deterministic: no DOM, no Math.random,
// no timers. Runs identically in the browser and on the Node server (which
// replays action logs to verify leaderboard submissions).
//
// Every player action returns a list of "steps" that the renderer animates:
//   { type: 'swap',   a, b, ok }                 – gem swap (ok=false → bounce back)
//   { type: 'clear',  cleared, upgraded, effects, hits, points, cascade }
//   { type: 'fall',   moves, spawns }            – gravity + refill
//   { type: 'transform', gems }                  – gems turned into specials
//   { type: 'shuffle', gems }                    – board reshuffled
// After each step `board` holds a snapshot of all gems so the renderer can
// always resync to the truth.

import { Rng } from './rng.js';

export const SPECIAL = Object.freeze({ NONE: 0, LINE_H: 1, LINE_V: 2, BOMB: 3, RAINBOW: 4 });
export const RAINBOW_COLOR = -1;

export const POINTS = Object.freeze({
  gem: 60,
  jelly: 100,
  crate: 100,
  makeLine: 120,
  makeBomb: 200,
  makeRainbow: 300,
  finaleMove: 250,
});

const key = (r, c) => r * 64 + c;
const unkey = (k) => [Math.floor(k / 64), k % 64];

export class Game {
  /**
   * cfg = {
   *   rows, cols, colors, moves, seed,
   *   mode: 'level' | 'daily' | 'endless',
   *   objectives: [{type:'score',target} | {type:'collect',color,count} |
   *                {type:'jelly'} | {type:'crate'}],
   *   stars: [s1, s2, s3]            – score thresholds
   *   holes:  [[r,c],...]            – cells that are not part of the board
   *   jelly:  [[r,c,layers],...]
   *   crates: [[r,c,hp],...]
   *   bonusMoves: bool               – endless: specials/cascades award moves
   * }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.colors = cfg.colors;
    this.rng = new Rng(cfg.seed);
    this.nextId = 1;
    this.score = 0;
    this.movesLeft = cfg.moves;
    this.movesMade = 0;
    this.state = 'playing'; // playing | won | lost
    this.collected = new Array(6).fill(0);
    this.log = []; // action log for replay verification
    this.stats = { specialsMade: 0, maxCascade: 0, combos: 0, rainbowsMade: 0, bonusMovesEarned: 0 };

    const R = this.rows, C = this.cols;
    this.hole = grid(R, C, false);
    this.crate = grid(R, C, 0);
    this.jelly = grid(R, C, 0);
    this.gems = grid(R, C, null);
    for (const [r, c] of cfg.holes || []) this.hole[r][c] = true;
    for (const [r, c, hp] of cfg.crates || []) if (!this.hole[r][c]) this.crate[r][c] = hp || 1;
    for (const [r, c, l] of cfg.jelly || []) if (!this.hole[r][c]) this.jelly[r][c] = l || 1;

    this.jellyTotal = this.countJelly();
    this.crateTotal = this.countCrates();
    this.fillInitial();
  }

  // ---------- board helpers ----------
  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }
  isCell(r, c) {
    return this.inBounds(r, c) && !this.hole[r][c];
  }
  isOpen(r, c) {
    // can hold a gem
    return this.isCell(r, c) && this.crate[r][c] === 0;
  }
  gem(r, c) {
    return this.inBounds(r, c) ? this.gems[r][c] : null;
  }
  newGem(color, special = SPECIAL.NONE) {
    return { id: this.nextId++, color, special };
  }
  countJelly() {
    let n = 0;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) n += this.jelly[r][c];
    return n;
  }
  countCrates() {
    let n = 0;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) n += this.crate[r][c];
    return n;
  }

  snapshot() {
    const out = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const g = this.gems[r][c];
        if (g) out.push({ id: g.id, r, c, color: g.color, special: g.special });
      }
    return out;
  }

  tiles() {
    const out = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        out.push({ r, c, hole: this.hole[r][c], crate: this.crate[r][c], jelly: this.jelly[r][c] });
    return out;
  }

  // ---------- generation ----------
  randomColorAvoiding(r, c) {
    for (let tries = 0; tries < 20; tries++) {
      const col = this.rng.int(this.colors);
      const l1 = this.gem(r, c - 1), l2 = this.gem(r, c - 2);
      const u1 = this.gem(r - 1, c), u2 = this.gem(r - 2, c);
      if (l1 && l2 && l1.color === col && l2.color === col) continue;
      if (u1 && u2 && u1.color === col && u2.color === col) continue;
      return col;
    }
    return this.rng.int(this.colors);
  }

  fillInitial() {
    for (let attempt = 0; attempt < 50; attempt++) {
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          this.gems[r][c] = this.isOpen(r, c) ? this.newGem(this.randomColorAvoiding(r, c)) : null;
        }
      if (this.findMatchGroups().length === 0 && this.findMove()) return;
    }
  }

  // ---------- matching ----------
  findRuns() {
    const runs = [];
    const R = this.rows, C = this.cols;
    for (let r = 0; r < R; r++) {
      let c = 0;
      while (c < C) {
        const g = this.gems[r][c];
        if (!g || g.color < 0) { c++; continue; }
        let e = c + 1;
        while (e < C && this.gems[r][e] && this.gems[r][e].color === g.color) e++;
        if (e - c >= 3) {
          const cells = [];
          for (let i = c; i < e; i++) cells.push([r, i]);
          runs.push({ dir: 'h', color: g.color, cells });
        }
        c = e;
      }
    }
    for (let c = 0; c < C; c++) {
      let r = 0;
      while (r < R) {
        const g = this.gems[r][c];
        if (!g || g.color < 0) { r++; continue; }
        let e = r + 1;
        while (e < R && this.gems[e][c] && this.gems[e][c].color === g.color) e++;
        if (e - r >= 3) {
          const cells = [];
          for (let i = r; i < e; i++) cells.push([i, c]);
          runs.push({ dir: 'v', color: g.color, cells });
        }
        r = e;
      }
    }
    return runs;
  }

  // Merge runs that share cells (L / T / + shapes).
  findMatchGroups() {
    const runs = this.findRuns();
    const parent = runs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map();
    runs.forEach((run, i) => {
      for (const [r, c] of run.cells) {
        const k = key(r, c);
        if (owner.has(k)) parent[find(i)] = find(owner.get(k));
        else owner.set(k, i);
      }
    });
    const groups = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, { runs: [], cells: new Map(), color: run.color });
      const g = groups.get(root);
      g.runs.push(run);
      for (const [r, c] of run.cells) g.cells.set(key(r, c), [r, c]);
    });
    return [...groups.values()];
  }

  // Decide which special (if any) a match group creates and where.
  planSpecial(group, preferred) {
    const maxLen = Math.max(...group.runs.map((r) => r.cells.length));
    const hasH = group.runs.some((r) => r.dir === 'h');
    const hasV = group.runs.some((r) => r.dir === 'v');
    let special = SPECIAL.NONE;
    if (maxLen >= 5) special = SPECIAL.RAINBOW;
    else if (hasH && hasV) special = SPECIAL.BOMB;
    else if (maxLen === 4) special = group.runs[0].dir === 'h' ? SPECIAL.LINE_H : SPECIAL.LINE_V;
    if (special === SPECIAL.NONE) return null;

    const cells = [...group.cells.values()];
    const usable = ([r, c]) => this.gems[r][c] && this.gems[r][c].special === SPECIAL.NONE;
    let at = null;
    for (const p of preferred || []) {
      if (p && group.cells.has(key(p[0], p[1])) && usable(p)) { at = p; break; }
    }
    if (!at && hasH && hasV) {
      // intersection cell
      const counts = new Map();
      for (const run of group.runs) for (const [r, c] of run.cells) counts.set(key(r, c), (counts.get(key(r, c)) || 0) + 1);
      for (const [k, n] of counts) if (n > 1 && usable(unkey(k))) { at = unkey(k); break; }
    }
    if (!at) {
      const longest = group.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
      const mid = longest.cells[Math.floor((longest.cells.length - 1) / 2)];
      if (usable(mid)) at = mid;
    }
    if (!at) at = cells.find(usable) || null;
    if (!at) return null;
    return { at, special, color: special === SPECIAL.RAINBOW ? RAINBOW_COLOR : group.color };
  }

  // ---------- move search ----------
  wouldMatchAt(r, c) {
    const g = this.gems[r][c];
    if (!g || g.color < 0) return false;
    const same = (rr, cc) => { const o = this.gem(rr, cc); return o && o.color === g.color; };
    let h = 1;
    for (let i = c - 1; same(r, i); i--) h++;
    for (let i = c + 1; same(r, i); i++) h++;
    if (h >= 3) return true;
    let v = 1;
    for (let i = r - 1; same(i, c); i--) v++;
    for (let i = r + 1; same(i, c); i++) v++;
    return v >= 3;
  }

  isSwapProductive(a, b) {
    const ga = this.gem(a[0], a[1]), gb = this.gem(b[0], b[1]);
    if (!ga || !gb) return false;
    if (ga.special === SPECIAL.RAINBOW || gb.special === SPECIAL.RAINBOW) return true;
    if (ga.special !== SPECIAL.NONE && gb.special !== SPECIAL.NONE) return true;
    this.gems[a[0]][a[1]] = gb;
    this.gems[b[0]][b[1]] = ga;
    const ok = this.wouldMatchAt(a[0], a[1]) || this.wouldMatchAt(b[0], b[1]);
    this.gems[a[0]][a[1]] = ga;
    this.gems[b[0]][b[1]] = gb;
    return ok;
  }

  allMoves() {
    const moves = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.isSwapProductive([r, c], [r, c + 1])) moves.push([[r, c], [r, c + 1]]);
        if (this.isSwapProductive([r, c], [r + 1, c])) moves.push([[r, c], [r + 1, c]]);
      }
    return moves;
  }

  findMove() {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        if (this.isSwapProductive([r, c], [r, c + 1])) return [[r, c], [r, c + 1]];
        if (this.isSwapProductive([r, c], [r + 1, c])) return [[r, c], [r + 1, c]];
      }
    return null;
  }

  // Hint: prefer moves that make specials / big matches.
  bestHint() {
    const moves = this.allMoves();
    if (!moves.length) return null;
    let best = moves[0], bestScore = -1;
    for (const m of moves) {
      const s = this.estimateMove(m);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  clone() {
    const g = Object.create(Game.prototype);
    Object.assign(g, this);
    g.rng = Object.assign(Object.create(Object.getPrototypeOf(this.rng)), this.rng);
    g.crate = this.crate.map((r) => r.slice());
    g.jelly = this.jelly.map((r) => r.slice());
    g.gems = this.gems.map((row) => row.map((x) => (x ? { ...x } : null)));
    g.collected = this.collected.slice();
    g.log = [];
    g.stats = { ...this.stats };
    return g;
  }

  // Goal-aware move choice: simulates every legal move on a copy and scores
  // the outcome by objective progress. Used for hints and the balance bot.
  smartMove() {
    const moves = this.allMoves();
    if (!moves.length) return null;
    const objs = this.cfg.objectives || [];
    const wantJelly = objs.some((o) => o.type === 'jelly');
    const wantCrate = objs.some((o) => o.type === 'crate');
    const collectColors = objs.filter((o) => o.type === 'collect' && this.collected[o.color] < o.count).map((o) => o.color);
    const j0 = this.countJelly(), c0 = this.countCrates();
    let best = moves[0], bestVal = -Infinity;
    for (const m of moves) {
      const sim = this.clone();
      sim.cfg = { ...this.cfg, mode: 'sim' };
      sim.rng.s = (this.rng.s ^ 0x5bd1e995) >>> 0; // no peeking at future refills
      const before = sim.score;
      sim.swap(m[0], m[1]);
      let v = (sim.score - before) / 200;
      if (wantJelly) v += (j0 - sim.countJelly()) * 6;
      if (wantCrate) v += (c0 - sim.countCrates()) * 6;
      for (const col of collectColors) v += Math.min(sim.collected[col] - this.collected[col], 40) * 2;
      // keep specials on board for later unless goals benefit now
      if (v > bestVal) { bestVal = v; best = m; }
    }
    return best;
  }

  estimateMove([a, b]) {
    const ga = this.gem(a[0], a[1]), gb = this.gem(b[0], b[1]);
    let s = 0;
    if (ga.special) s += 10 + ga.special;
    if (gb.special) s += 10 + gb.special;
    this.gems[a[0]][a[1]] = gb;
    this.gems[b[0]][b[1]] = ga;
    for (const g of this.findMatchGroups()) s += g.cells.size + (g.cells.size >= 4 ? 5 : 0);
    this.gems[a[0]][a[1]] = ga;
    this.gems[b[0]][b[1]] = gb;
    return s;
  }

  // ---------- public actions ----------
  canAct() {
    return this.state === 'playing' && this.movesLeft > 0;
  }

  swap(a, b) {
    const steps = [];
    if (!this.canAct()) return { ok: false, steps };
    if (!this.isCell(a[0], a[1]) || !this.isCell(b[0], b[1])) return { ok: false, steps };
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return { ok: false, steps };
    const ga = this.gem(a[0], a[1]), gb = this.gem(b[0], b[1]);
    if (!ga || !gb) return { ok: false, steps };

    if (!this.isSwapProductive(a, b)) {
      steps.push({ type: 'swap', a, b, ok: false });
      return { ok: false, steps };
    }

    this.log.push(['s', a[0], a[1], b[0], b[1]]);
    this.gems[a[0]][a[1]] = gb;
    this.gems[b[0]][b[1]] = ga;
    steps.push({ type: 'swap', a, b, ok: true, board: this.snapshot() });
    this.movesLeft--;
    this.movesMade++;

    // gb now at a, ga now at b
    const sa = ga.special, sb = gb.special;
    let initial = null;
    if (sa === SPECIAL.RAINBOW || sb === SPECIAL.RAINBOW || (sa && sb)) {
      initial = this.comboActivation(b, ga, a, gb, steps);
    }
    this.resolve(steps, initial, [b, a]);
    this.afterMove(steps);
    return { ok: true, steps };
  }

  // Booster: smash a single gem (or damage a crate). Does not cost a move.
  hammer(r, c) {
    const steps = [];
    if (this.state !== 'playing' || !this.isCell(r, c)) return { ok: false, steps };
    if (!this.gems[r][c] && !this.crate[r][c]) return { ok: false, steps };
    this.log.push(['h', r, c]);
    this.resolve(steps, { cells: [[r, c]], spent: new Set() }, null);
    this.afterMove(steps, true);
    return { ok: true, steps };
  }

  // Booster: shuffle board. Does not cost a move.
  shuffleBooster() {
    const steps = [];
    if (this.state !== 'playing') return { ok: false, steps };
    this.log.push(['x']);
    this.shuffle(steps);
    return { ok: true, steps };
  }

  // Booster / continue: extra moves. Allowed when out of moves (lost) too.
  addMoves(n) {
    if (this.state === 'won') return false;
    this.log.push(['m', n]);
    this.movesLeft += n;
    this.state = 'playing';
    return true;
  }

  // ---------- resolution ----------
  // Swapping two specials or a rainbow – returns the initial clear plan.
  comboActivation(posA, gA, posB, gB, steps) {
    // posA holds gA, posB holds gB (after swap)
    const spent = new Set([gA.id, gB.id]);
    const S = SPECIAL;
    const [ra, ca] = posA, [rb, cb] = posB;
    this.stats.combos++;
    const cells = [];
    const addArea = (r0, c0, rad) => {
      for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) if (this.isCell(r, c)) cells.push([r, c]);
    };
    const addRow = (r) => { for (let c = 0; c < this.cols; c++) if (this.isCell(r, c)) cells.push([r, c]); };
    const addCol = (c) => { for (let r = 0; r < this.rows; r++) if (this.isCell(r, c)) cells.push([r, c]); };
    const isLine = (s) => s === S.LINE_H || s === S.LINE_V;
    const effects = [];

    if (gA.special === S.RAINBOW && gB.special === S.RAINBOW) {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (this.isCell(r, c)) cells.push([r, c]);
      effects.push({ kind: 'nova', r: ra, c: ca });
      return { cells, spent, effects };
    }
    if (gA.special === S.RAINBOW || gB.special === S.RAINBOW) {
      const [rp, cp, other] = gA.special === S.RAINBOW ? [ra, ca, gB] : [rb, cb, gA];
      const [ro, co] = gA.special === S.RAINBOW ? [rb, cb] : [ra, ca];
      cells.push([rp, cp], [ro, co]);
      const color = other.color;
      const targets = [];
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) {
          const g = this.gems[r][c];
          if (g && g.color === color && g.id !== other.id) targets.push([r, c]);
        }
      if (other.special !== S.NONE) {
        // convert all of that color into the other's special type, then fire them
        const transformed = [];
        for (const [r, c] of targets) {
          const g = this.gems[r][c];
          if (g.special === S.NONE) {
            g.special = isLine(other.special) ? (this.rng.int(2) ? S.LINE_H : S.LINE_V) : other.special;
          }
          transformed.push({ id: g.id, r, c, color: g.color, special: g.special });
        }
        spent.delete(other.id);
        if (transformed.length) steps.push({ type: 'transform', gems: transformed, board: this.snapshot() });
      }
      cells.push(...targets);
      effects.push({ kind: 'rainbow', r: rp, c: cp, targets });
      return { cells, spent, effects };
    }
    // two non-rainbow specials
    if (isLine(gA.special) && isLine(gB.special)) {
      addRow(ra); addCol(ca);
      effects.push({ kind: 'line', r: ra, c: ca, dir: 'h' }, { kind: 'line', r: ra, c: ca, dir: 'v' });
    } else if (gA.special === S.BOMB && gB.special === S.BOMB) {
      addArea(ra, ca, 2);
      effects.push({ kind: 'bomb', r: ra, c: ca, radius: 2 });
    } else {
      // line + bomb: 3 rows and 3 cols
      for (let d = -1; d <= 1; d++) { addRow(ra + d); addCol(ca + d); }
      effects.push({ kind: 'line', r: ra, c: ca, dir: 'h', width: 3 }, { kind: 'line', r: ra, c: ca, dir: 'v', width: 3 });
    }
    cells.push([rb, cb]);
    return { cells, spent, effects };
  }

  // Main cascade loop.
  resolve(steps, initial, preferred) {
    let cascade = 0;
    let pending = initial;
    let pref = preferred;
    for (let guard = 0; guard < 200; guard++) {
      const groups = this.findMatchGroups();
      if (!pending && groups.length === 0) break;
      cascade++;
      this.clearPhase(steps, groups, pending, pref, cascade);
      pending = null;
      pref = null;
      this.gravity(steps);
    }
    if (cascade > this.stats.maxCascade) this.stats.maxCascade = cascade;
    if (this.cfg.bonusMoves && cascade >= 4) this.awardMoves(cascade >= 6 ? 2 : 1, steps);
    return cascade;
  }

  awardMoves(n, steps) {
    this.movesLeft += n;
    this.stats.bonusMovesEarned += n;
    steps.push({ type: 'bonus', moves: n });
  }

  clearPhase(steps, groups, pending, preferred, cascade) {
    const toClear = new Map(); // key -> [r,c]
    const queue = [];
    const spent = new Set(pending ? pending.spent : []);
    const effects = pending ? [...(pending.effects || [])] : [];
    const upgrades = [];
    const protectedIds = new Set();
    let points = 0;

    // plan specials from match groups
    for (const group of groups) {
      const plan = this.planSpecial(group, preferred);
      for (const [k, rc] of group.cells) {
        if (plan && plan.at[0] === rc[0] && plan.at[1] === rc[1]) continue;
        toClear.set(k, rc);
      }
      if (plan) {
        const g = this.gems[plan.at[0]][plan.at[1]];
        upgrades.push({ g, plan });
        protectedIds.add(g.id);
      }
      // adjacent crate damage from matches
      for (const [, [r, c]] of group.cells) {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (this.isCell(rr, cc) && this.crate[rr][cc] > 0) toClear.set(key(rr, cc), [rr, cc]);
        }
      }
    }
    if (pending) for (const [r, c] of pending.cells) toClear.set(key(r, c), [r, c]);

    for (const [, [r, c]] of toClear) queue.push([r, c]);

    // chain-trigger specials
    const fired = new Set();
    const trigger = (r, c) => {
      const g = this.gems[r][c];
      if (!g || g.special === SPECIAL.NONE || spent.has(g.id) || fired.has(g.id) || protectedIds.has(g.id)) return;
      fired.add(g.id);
      const add = (rr, cc) => {
        if (!this.isCell(rr, cc)) return;
        const k = key(rr, cc);
        if (!toClear.has(k)) { toClear.set(k, [rr, cc]); queue.push([rr, cc]); }
      };
      switch (g.special) {
        case SPECIAL.LINE_H:
          for (let cc = 0; cc < this.cols; cc++) add(r, cc);
          effects.push({ kind: 'line', r, c, dir: 'h' });
          break;
        case SPECIAL.LINE_V:
          for (let rr = 0; rr < this.rows; rr++) add(rr, c);
          effects.push({ kind: 'line', r, c, dir: 'v' });
          break;
        case SPECIAL.BOMB:
          for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) add(rr, cc);
          effects.push({ kind: 'bomb', r, c, radius: 1 });
          break;
        case SPECIAL.RAINBOW: {
          // triggered indirectly: wipe the most common colour
          const counts = new Array(this.colors).fill(0);
          for (let rr = 0; rr < this.rows; rr++) for (let cc = 0; cc < this.cols; cc++) {
            const o = this.gems[rr][cc];
            if (o && o.color >= 0) counts[o.color]++;
          }
          let best = 0;
          for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
          const targets = [];
          for (let rr = 0; rr < this.rows; rr++) for (let cc = 0; cc < this.cols; cc++) {
            const o = this.gems[rr][cc];
            if (o && o.color === best) { add(rr, cc); targets.push([rr, cc]); }
          }
          effects.push({ kind: 'rainbow', r, c, targets });
          break;
        }
      }
    };
    while (queue.length) {
      const [r, c] = queue.shift();
      trigger(r, c);
    }

    // apply clears
    const cleared = [];
    const hits = [];
    const mult = cascade;
    for (const [, [r, c]] of toClear) {
      if (this.crate[r][c] > 0) {
        this.crate[r][c]--;
        points += POINTS.crate;
        hits.push({ kind: 'crate', r, c, left: this.crate[r][c] });
        continue;
      }
      const g = this.gems[r][c];
      if (!g || protectedIds.has(g.id)) continue;
      cleared.push({ id: g.id, r, c, color: g.color, special: g.special });
      if (g.color >= 0) this.collected[g.color]++;
      this.gems[r][c] = null;
      points += POINTS.gem * mult;
      if (this.jelly[r][c] > 0) {
        this.jelly[r][c]--;
        points += POINTS.jelly;
        hits.push({ kind: 'jelly', r, c, left: this.jelly[r][c] });
      }
    }
    // jelly under newly-created specials also counts (the gem "matched" there)
    const upgraded = [];
    for (const { g, plan } of upgrades) {
      const [r, c] = plan.at;
      if (this.gems[r][c] !== g) continue;
      g.special = plan.special;
      g.color = plan.color;
      upgraded.push({ id: g.id, r, c, color: g.color, special: g.special });
      this.stats.specialsMade++;
      if (plan.special === SPECIAL.RAINBOW) {
        this.stats.rainbowsMade++;
        points += POINTS.makeRainbow;
      } else if (plan.special === SPECIAL.BOMB) points += POINTS.makeBomb;
      else points += POINTS.makeLine;
      if (this.jelly[r][c] > 0) {
        this.jelly[r][c]--;
        points += POINTS.jelly;
        hits.push({ kind: 'jelly', r, c, left: this.jelly[r][c] });
      }
      if (this.cfg.bonusMoves) this.awardMoves(plan.special === SPECIAL.RAINBOW ? 2 : 1, steps);
    }

    this.score += points;
    steps.push({ type: 'clear', cleared, upgraded, effects, hits, points, cascade, board: this.snapshot() });
  }

  gravity(steps) {
    const moves = [];
    const spawns = [];
    for (let c = 0; c < this.cols; c++) {
      let r = this.rows - 1;
      while (r >= 0) {
        // find segment of open cells [top..bottom]
        while (r >= 0 && !this.isOpen(r, c)) r--;
        if (r < 0) break;
        const bottom = r;
        while (r >= 0 && this.isOpen(r, c)) r--;
        const top = r + 1;
        // compact gems downward
        let write = bottom;
        for (let rr = bottom; rr >= top; rr--) {
          const g = this.gems[rr][c];
          if (g) {
            if (rr !== write) {
              this.gems[write][c] = g;
              this.gems[rr][c] = null;
              moves.push({ id: g.id, fromR: rr, toR: write, c });
            }
            write--;
          }
        }
        const empty = write - top + 1;
        for (let rr = write; rr >= top; rr--) {
          const g = this.newGem(this.rng.int(this.colors));
          this.gems[rr][c] = g;
          spawns.push({ id: g.id, r: rr, c, color: g.color, special: g.special, fromR: rr - empty });
        }
      }
    }
    if (moves.length || spawns.length) steps.push({ type: 'fall', moves, spawns, board: this.snapshot() });
  }

  shuffle(steps) {
    const cells = [];
    const pool = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const g = this.gems[r][c];
        if (g) { cells.push([r, c]); pool.push(g); }
      }
    for (let attempt = 0; attempt < 100; attempt++) {
      this.rng.shuffle(pool);
      cells.forEach(([r, c], i) => (this.gems[r][c] = pool[i]));
      if (this.findMatchGroups().length === 0 && this.findMove()) {
        steps.push({ type: 'shuffle', board: this.snapshot() });
        return;
      }
    }
    // fall back: recolour normal gems
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const [r, c] of cells) {
        const g = this.gems[r][c];
        if (g.special === SPECIAL.NONE) g.color = this.randomColorAvoiding(r, c);
      }
      if (this.findMatchGroups().length === 0 && this.findMove()) break;
    }
    steps.push({ type: 'shuffle', board: this.snapshot() });
  }

  // ---------- objectives / end of move ----------
  objectiveProgress() {
    return (this.cfg.objectives || []).map((o) => {
      switch (o.type) {
        case 'score': return { ...o, current: this.score, target: o.target, done: this.score >= o.target };
        case 'collect': {
          const cur = Math.min(this.collected[o.color], o.count);
          return { ...o, current: cur, target: o.count, done: cur >= o.count };
        }
        case 'jelly': {
          const left = this.countJelly();
          return { ...o, current: this.jellyTotal - left, target: this.jellyTotal, left, done: left === 0 };
        }
        case 'crate': {
          const left = this.countCrates();
          return { ...o, current: this.crateTotal - left, target: this.crateTotal, left, done: left === 0 };
        }
        default: return { ...o, done: true };
      }
    });
  }

  // Score-only objectives keep playing until moves run out.
  objectivesComplete() {
    const prog = this.objectiveProgress();
    return prog.length > 0 && prog.every((p) => p.done);
  }
  hasNonScoreObjective() {
    return (this.cfg.objectives || []).some((o) => o.type !== 'score');
  }

  starsFor(score) {
    const t = this.cfg.stars || [0, 0, 0];
    return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
  }

  stars() {
    if (this.state !== 'won') return 0;
    return Math.max(1, this.starsFor(this.score));
  }

  afterMove(steps, free = false) {
    if (this.cfg.mode === 'level') {
      if (this.hasNonScoreObjective() && this.objectivesComplete()) {
        this.finale(steps);
        this.state = 'won';
        steps.push({ type: 'end', state: 'won' });
        return;
      }
      if (this.movesLeft <= 0) {
        this.state = this.objectivesComplete() ? 'won' : 'lost';
        if (this.state === 'won') this.finale(steps);
        steps.push({ type: 'end', state: this.state });
        return;
      }
    } else if (this.movesLeft <= 0) {
      this.state = 'won'; // daily / endless just finish
      steps.push({ type: 'end', state: 'won' });
      return;
    }
    if (!this.findMove()) this.shuffle(steps);
    void free;
  }

  // Leftover moves turn into line gems that all fire ("Grand Finale").
  finale(steps) {
    const n = Math.min(this.movesLeft, 20);
    if (n > 0) {
      const transformed = [];
      for (let i = 0; i < n; i++) {
        const candidates = [];
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const g = this.gems[r][c];
          if (g && g.special === SPECIAL.NONE) candidates.push([r, c]);
        }
        if (!candidates.length) break;
        const [r, c] = this.rng.pick(candidates);
        const g = this.gems[r][c];
        g.special = this.rng.int(2) ? SPECIAL.LINE_H : SPECIAL.LINE_V;
        transformed.push({ id: g.id, r, c, color: g.color, special: g.special });
        this.score += POINTS.finaleMove;
      }
      this.movesLeft = 0;
      steps.push({ type: 'finale', moves: n, points: n * POINTS.finaleMove, gems: transformed, board: this.snapshot() });
    }
    // fire every special on the board, repeatedly, until none left
    for (let guard = 0; guard < 30; guard++) {
      const specials = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const g = this.gems[r][c];
        if (g && g.special !== SPECIAL.NONE) specials.push([r, c]);
      }
      if (!specials.length) break;
      this.resolve(steps, { cells: specials, spent: new Set() }, null);
    }
  }
}

function grid(R, C, v) {
  return Array.from({ length: R }, () => new Array(C).fill(v));
}

// Replay an action log against a fresh game – used by the server to verify
// scores and by tests to ensure determinism.
export function replay(cfg, log, { maxBoosters = Infinity } = {}) {
  const game = new Game(cfg);
  let boosters = 0;
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', game };
    let res;
    switch (a[0]) {
      case 's':
        res = game.swap([a[1], a[2]], [a[3], a[4]]);
        if (!res.ok) return { ok: false, reason: 'invalid swap', game };
        break;
      case 'h':
        if (++boosters > maxBoosters) return { ok: false, reason: 'too many boosters', game };
        res = game.hammer(a[1], a[2]);
        if (!res.ok) return { ok: false, reason: 'invalid hammer', game };
        break;
      case 'x':
        if (++boosters > maxBoosters) return { ok: false, reason: 'too many boosters', game };
        if (!game.shuffleBooster().ok) return { ok: false, reason: 'invalid shuffle', game };
        break;
      case 'm':
        if (++boosters > maxBoosters) return { ok: false, reason: 'too many boosters', game };
        if (a[1] !== 5 || !game.addMoves(5)) return { ok: false, reason: 'invalid moves', game };
        break;
      default:
        return { ok: false, reason: 'unknown action', game };
    }
  }
  return { ok: true, game };
}

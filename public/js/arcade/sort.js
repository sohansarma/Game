// Sort Splash – colour-sort puzzles against an oxygen supply. Pure &
// deterministic. Each pour uses 1 oxygen; solving a puzzle scores points
// and refills oxygen, then a harder puzzle appears. Undo is free; an extra
// empty tube can be added once per puzzle for 5 oxygen. The run ends when
// oxygen runs out. Score = sum of puzzle rewards.

import { Rng, hashString } from '../rng.js';

export const CAP = 4;
const START_O2 = 45;

class SortSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.level = 0;
    this.points = 0;
    this.oxygen = START_O2;
    this.solved = 0;
    this.over = false;
    this.overReason = '';
    this.log = [];
    this.history = [];
    this.nextLevel();
  }

  get score() {
    return this.points;
  }

  get colors() {
    return Math.min(9, 3 + Math.floor(this.level / 2));
  }

  nextLevel() {
    this.level++;
    const k = this.colors;
    const rng = new Rng(hashString(`${this.seed}:sort:${this.level}`));
    // From puzzle 3 there is only one spare tube; puzzles are only used if
    // the solver proves them solvable (else fall back to two spare tubes).
    const spare = this.level <= 2 ? 2 : 1;
    let chosen = null;
    for (let attempt = 0; attempt < 25 && !chosen; attempt++) {
      const tubes = shuffled(rng, k, spare);
      if (spare === 2 || solve(tubes, 6000)) chosen = tubes;
    }
    this.tubes = chosen || shuffled(rng, k, 2);
    this.extraUsed = false;
    this.history = [];
    this.levelMoves = 0;
  }

  isSolved() {
    return this.tubes.every((t) => t.length === 0 || (t.length === CAP && t.every((b) => b === t[0])));
  }

  /** How many balls would move from a to b (0 = illegal). */
  pourCount(a, b) {
    const A = this.tubes[a], B = this.tubes[b];
    if (!A || !B || a === b || !A.length || B.length >= CAP) return 0;
    const top = A[A.length - 1];
    if (B.length && B[B.length - 1] !== top) return 0;
    let run = 0;
    for (let i = A.length - 1; i >= 0 && A[i] === top; i--) run++;
    // pointless: moving a whole single-colour tube into an empty tube
    if (!B.length && run === A.length) return 0;
    return Math.min(run, CAP - B.length);
  }

  pour(a, b) {
    if (this.over) return { ok: false };
    const n = this.pourCount(a, b);
    if (!n) return { ok: false };
    this.log.push(['p', a, b]);
    this.history.push(this.tubes.map((t) => t.slice()));
    const A = this.tubes[a], B = this.tubes[b];
    for (let i = 0; i < n; i++) B.push(A.pop());
    this.oxygen--;
    this.levelMoves++;
    const res = { ok: true, n, a, b, color: B[B.length - 1], solved: false };
    const B_done = B.length === CAP && B.every((x) => x === B[0]);
    res.tubeDone = B_done;
    if (this.isSolved()) {
      const k = this.colors;
      const reward = 50 + 25 * k + Math.max(0, 40 - this.levelMoves) * 2;
      this.points += reward;
      this.oxygen += 6 + k * 2;
      this.solved++;
      res.solved = true;
      res.reward = reward;
      this.nextLevel();
    } else if (this.oxygen <= 0) {
      this.over = true;
      this.overReason = 'Out of oxygen!';
    }
    return res;
  }

  undo() {
    if (this.over || !this.history.length) return { ok: false };
    this.log.push(['u']);
    this.tubes = this.history.pop();
    return { ok: true };
  }

  extraTube() {
    if (this.over || this.extraUsed || this.oxygen <= 5) return { ok: false };
    this.log.push(['e']);
    this.extraUsed = true;
    this.oxygen -= 5;
    this.tubes.push([]);
    for (const h of this.history) h.push([]); // the extra tube survives undo
    return { ok: true };
  }

  quit() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
    this.overReason = 'Surfaced for air';
  }
}

function shuffled(rng, k, spare) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const balls = [];
    for (let c = 0; c < k; c++) for (let i = 0; i < CAP; i++) balls.push(c);
    rng.shuffle(balls);
    const tubes = [];
    for (let t = 0; t < k; t++) tubes.push(balls.slice(t * CAP, t * CAP + CAP));
    for (let i = 0; i < spare; i++) tubes.push([]);
    const complete = tubes.filter((t) => t.length === CAP && t.every((b) => b === t[0])).length;
    if (complete <= 1) return tubes;
  }
  return null;
}

/** Breadth-first search for a solution (list of [from, to]) within maxNodes. */
export function solve(start, maxNodes = 20000) {
  const key = (t) => t.map((x) => x.join('')).sort().join('|');
  const done = (ts) => ts.every((t) => !t.length || (t.length === CAP && t.every((b) => b === t[0])));
  const seen = new Set([key(start)]);
  const queue = [[start.map((t) => t.slice()), []]];
  for (let head = 0; head < queue.length && head < maxNodes; head++) {
    const [ts, path] = queue[head];
    if (done(ts)) return path;
    for (let a = 0; a < ts.length; a++) {
      const A = ts[a];
      if (!A.length) continue;
      const top = A[A.length - 1];
      let run = 0;
      for (let i = A.length - 1; i >= 0 && A[i] === top; i--) run++;
      for (let b = 0; b < ts.length; b++) {
        const B = ts[b];
        if (a === b || B.length >= CAP || (B.length && B[B.length - 1] !== top) || (!B.length && run === A.length)) continue;
        const n = Math.min(run, CAP - B.length);
        const next = ts.map((t) => t.slice());
        for (let i = 0; i < n; i++) next[b].push(next[a].pop());
        const k = key(next);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([next, [...path, [a, b]]]);
      }
    }
  }
  return null;
}

function replay(seed, log) {
  const sim = new SortSim(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    let r;
    if (a[0] === 'p') r = sim.pour(a[1], a[2]);
    else if (a[0] === 'u') r = sim.undo();
    else if (a[0] === 'e') r = sim.extraTube();
    else if (a[0] === 'q') { sim.quit(); r = { ok: true }; }
    else return { ok: false, reason: 'unknown action', sim };
    if (!r.ok) return { ok: false, reason: 'invalid action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'sort',
  title: 'Sort Splash',
  icon: '🧪',
  tagline: 'Sort the colours before your air runs out',
  color: ['#80deea', '#1a237e'],
  maxLog: 8000,
  shellsPer: 60,
  milestone: 2500,
  create: (seed) => new SortSim(seed),
  replay,
};
export { SortSim };

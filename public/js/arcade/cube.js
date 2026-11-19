// Cube Twist – a 3D twisty-cube puzzle (2x2 and 3x3). Pure & deterministic.
//
// The run: each stage hands you a scrambled cube and a twist allowance that
// joins your twist pool. Solve it to score (more for harder cubes and for
// twists left over), then a harder scramble appears. Allowances shrink at
// later stages, so every run ends when the pool hits zero.
//
// Geometry: cubies sit on doubled integer coordinates (2x2: ±1, 3x3: -2/0/2),
// so quarter turns are exact. A twist is [axis 0|1|2 (x,y,z), layer (that
// coordinate), dir ±1 (right-hand rule around +axis)].

import { Rng, hashString } from '../rng.js';

export const COLORS = ['#ffffff', '#ffd500', '#c41e3a', '#ff5800', '#0051ba', '#009e60']; // U D F B R L -> white, yellow, red, orange, blue, green
// face normals in the same order: +y (up), -y, +z (front), -z, +x (right), -x
export const FACE_NORMALS = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];

/** Rotate integer vector v a quarter turn around axis by dir (right-hand). */
export function rotQ(v, axis, dir) {
  const [x, y, z] = v;
  if (axis === 0) return [x, -dir * z, dir * y];
  if (axis === 1) return [dir * z, y, -dir * x];
  return [-dir * y, dir * x, z];
}

export class Cube {
  constructor(n) {
    this.n = n;
    this.cubies = [];
    const coords = n === 2 ? [-1, 1] : [-2, 0, 2];
    const edge = coords[coords.length - 1];
    for (const x of coords) for (const y of coords) for (const z of coords) {
      if (n === 3 && x === 0 && y === 0 && z === 0) continue;
      const stickers = [];
      FACE_NORMALS.forEach((nrm, c) => {
        if ((nrm[0] && x === nrm[0] * edge) || (nrm[1] && y === nrm[1] * edge) || (nrm[2] && z === nrm[2] * edge)) stickers.push({ n: nrm.slice(), c });
      });
      this.cubies.push({ p: [x, y, z], stickers, id: this.cubies.length });
    }
  }

  get layers() {
    return this.n === 2 ? [-1, 1] : [-2, 0, 2];
  }

  validTwist(axis, layer, dir) {
    return [0, 1, 2].includes(axis) && this.layers.includes(layer) && (dir === 1 || dir === -1);
  }

  twist(axis, layer, dir) {
    for (const cb of this.cubies) {
      if (cb.p[axis] !== layer) continue;
      cb.p = rotQ(cb.p, axis, dir);
      for (const s of cb.stickers) s.n = rotQ(s.n, axis, dir);
    }
  }

  /** Solved = every outward face shows a single colour (in any orientation). */
  solved() {
    const seen = new Map();
    for (const cb of this.cubies) {
      for (const s of cb.stickers) {
        const k = s.n.join(',');
        if (!seen.has(k)) seen.set(k, s.c);
        else if (seen.get(k) !== s.c) return false;
      }
    }
    return true;
  }
}

const inverse = (t) => [t[0], t[1], -t[2]];

// Logs store a twist as one small number (keeps long runs compact):
// axis * 6 + layer index * 2 + (dir > 0 ? 1 : 0)
export function encodeTwist(layers, axis, layer, dir) {
  return axis * 6 + layers.indexOf(layer) * 2 + (dir > 0 ? 1 : 0);
}
export function decodeTwist(layers, code) {
  if (!Number.isInteger(code) || code < 0 || code > 17) return null;
  const axis = Math.floor(code / 6), li = Math.floor((code % 6) / 2);
  if (li >= layers.length) return null;
  return [axis, layers[li], code % 2 ? 1 : -1];
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export const RUN_CUBES = 20;

/** Stage plan: cube size, scramble depth and twist allowance. */
export function stagePlan(stage) {
  if (stage === 1) return { n: 2, depth: 3, allow: 30 };
  if (stage === 2) return { n: 2, depth: 6, allow: 40 };
  if (stage === 3) return { n: 2, depth: 11, allow: 60 };
  const DEPTHS = [3, 4, 5, 6, 8, 10, 12, 15, 18, 22]; // stages 4..13
  const i = stage - 4;
  if (i < DEPTHS.length) return { n: 3, depth: DEPTHS[i], allow: DEPTHS[i] * 5 + 15 };
  // full scrambles from stage 14 on, with a shrinking allowance
  return { n: 3, depth: 25, allow: Math.max(70, 140 - (stage - 14) * 6) };
}

class CubeRun {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.stage = 0;
    this.points = 0;
    this.twists = 0;
    this.solvedCount = 0;
    this.over = false;
    this.overReason = '';
    this.log = [];
    this.nextCube();
  }

  get score() {
    return this.points;
  }

  nextCube() {
    this.stage++;
    const plan = stagePlan(this.stage);
    this.plan = plan;
    this.cube = new Cube(plan.n);
    const rng = new Rng(hashString(`${this.seed}:cube:${this.stage}`));
    const layers = this.cube.layers;
    // random twists; never the same axis twice in a row (no trivial cancels)
    this.stack = [];
    let lastAxis = -1;
    for (let tries = 0; tries < 20 && (this.stack.length === 0 || this.cube.solved()); tries++) {
      for (let i = 0; i < plan.depth; i++) {
        let axis = rng.int(3);
        if (axis === lastAxis) axis = (axis + 1 + rng.int(2)) % 3;
        lastAxis = axis;
        const t = [axis, layers[rng.int(layers.length)], rng.next() < 0.5 ? 1 : -1];
        this.cube.twist(...t);
        this.stack.push(t);
      }
    }
    this.twists += plan.allow;
    this.cubeMoves = 0;
    this.mine = []; // your twists on this cube (for free undo)
    this.startTick = null;
  }

  /** Undo your last twist on this cube – free (the twist is refunded). */
  undo() {
    if (this.over || !this.mine.length) return { ok: false };
    const t = this.mine.pop();
    const inv = inverse(t);
    this.log.push(['u']);
    this.cube.twist(...inv);
    const top = this.stack[this.stack.length - 1];
    if (top && same(top, t)) this.stack.pop();
    else this.stack.push(inv);
    this.twists++;
    this.cubeMoves--;
    return { ok: true, t: inv };
  }

  /** Player twist. Returns { ok, solved?, reward? }. */
  twist(axis, layer, dir) {
    if (this.over || !this.cube.validTwist(axis, layer, dir) || this.twists <= 0) return { ok: false };
    const t = [axis, layer, dir];
    this.log.push(encodeTwist(this.cube.layers, axis, layer, dir));
    this.cube.twist(axis, layer, dir);
    // keep a cancelled history: twisting back pops instead of pushing
    const top = this.stack[this.stack.length - 1];
    if (top && same(inverse(top), t)) this.stack.pop();
    else this.stack.push(t);
    this.twists--;
    this.cubeMoves++;
    this.mine.push(t);
    const res = { ok: true, solved: false };
    if (this.cube.solved()) {
      const p = this.plan;
      const reward = 40 + p.depth * (p.n === 2 ? 10 : 18) + this.stage * 25 + Math.max(0, p.allow - this.cubeMoves) * 3;
      this.points += reward;
      this.solvedCount++;
      res.solved = true;
      res.reward = reward;
      res.moves = this.cubeMoves;
      if (this.stage >= RUN_CUBES) {
        // a full run is 20 cubes – finishing all of them is the goal
        this.points += 500 + this.twists * 2;
        this.over = true;
        this.overReason = `All ${RUN_CUBES} cubes solved! 🏆`;
        res.complete = true;
        return res;
      }
      this.nextCube();
    } else if (this.twists <= 0) {
      this.over = true;
      this.overReason = 'Out of twists!';
    }
    return res;
  }

  quit() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
    this.overReason = 'Put the cube down';
  }
}

function replay(seed, log) {
  const sim = new CubeRun(seed);
  for (const a of log) {
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    let r;
    if (typeof a === 'number') { const t = decodeTwist(sim.cube.layers, a); r = t ? sim.twist(...t) : { ok: false }; }
    else if (Array.isArray(a) && a[0] === 'q') { sim.quit(); r = { ok: true }; }
    else if (Array.isArray(a) && a[0] === 'u') r = sim.undo();
    else return { ok: false, reason: 'unknown action', sim };
    if (!r.ok) return { ok: false, reason: 'invalid action', sim };
  }
  return { ok: true, sim };
}

/** Standard notation for a twist (U D L R F B, M E S for 3x3 middles, ' = counter-clockwise). */
export function notation(n, axis, layer, dir) {
  const hi = n === 2 ? 1 : 2, lo = -hi;
  // [axis][layer] -> [letter, dir that is clockwise for that face]
  const map = {
    0: { [hi]: ['R', -1], [lo]: ['L', 1], 0: ['M', 1] },
    1: { [hi]: ['U', -1], [lo]: ['D', 1], 0: ['E', 1] },
    2: { [hi]: ['F', -1], [lo]: ['B', 1], 0: ['S', -1] },
  };
  const [f, cw] = map[axis][layer];
  return f + (dir === cw ? '' : "'");
}

/** Free solve: one full scramble, no twist limit – just you, a timer and your moves. */
export class CubeFree {
  constructor(seed, n = 3) {
    const rng = new Rng(seed >>> 0);
    this.plan = { n, depth: n === 2 ? 11 : 25, allow: Infinity };
    this.stage = 1;
    this.cube = new Cube(n);
    this.stack = [];
    this.scramble = [];
    const layers = this.cube.layers.filter((l) => l !== 0); // outer turns only, like a real scramble
    const faces = [];
    for (let a = 0; a < 3; a++) for (const l of layers) faces.push([a, l]);
    const done = []; // [axis, layer] of each scramble move
    this.scrambleRaw = [];
    while (this.cube.solved() || this.scramble.length < this.plan.depth) {
      const [axis, layer] = faces[rng.int(faces.length)];
      const last = done[done.length - 1], prev = done[done.length - 2];
      if (last && last[0] === axis && last[1] === layer) continue; // same face twice
      if (last && prev && last[0] === axis && prev[0] === axis) continue; // three on one axis
      const kind = rng.int(3); // 0: clockwise, 1: counter, 2: half turn
      const dir = rng.next() < 0.5 ? 1 : -1;
      const reps = kind === 2 ? 2 : 1;
      for (let i = 0; i < reps; i++) { this.cube.twist(axis, layer, dir); this.scrambleRaw.push([axis, layer, dir]); }
      done.push([axis, layer]);
      this.scramble.push(kind === 2 ? notation(n, axis, layer, dir)[0] + '2' : notation(n, axis, layer, dir));
      if (this.scramble.length > 60) break;
    }
    this.twists = Infinity;
    this.cubeMoves = 0;
    this.points = 0;
    this.mine = [];
    this.log = [];
    this.seed = seed >>> 0;
    this.over = false;
    this.solved = false;
    this.free = true;
  }
  get score() { return 0; }
  twist(axis, layer, dir) {
    if (this.over || !this.cube.validTwist(axis, layer, dir)) return { ok: false };
    this.cube.twist(axis, layer, dir);
    this.log.push(encodeTwist(this.cube.layers, axis, layer, dir));
    this.mine.push([axis, layer, dir]);
    this.cubeMoves++;
    if (this.cube.solved()) { this.over = true; this.solved = true; this.overReason = 'Solved!'; return { ok: true, solved: true, moves: this.cubeMoves, free: true }; }
    return { ok: true, solved: false };
  }
  undo() {
    if (this.over || this.mine.length <= (this.undoFloor || 0)) return { ok: false };
    const t = this.mine.pop();
    const inv = inverse(t);
    this.cube.twist(...inv);
    this.log.push(['u']);
    this.cubeMoves--;
    return { ok: true, t: inv };
  }
  quit() { if (this.over) return; this.log.push(['q']); this.over = true; this.overReason = 'Stopped'; }
  /** x / z: turn the whole cube (all layers) – logged, but not a move */
  rotate(axis, dir) {
    if (this.over || ![0, 1, 2].includes(axis) || (dir !== 1 && dir !== -1)) return { ok: false };
    for (const l of this.cube.layers) this.cube.twist(axis, l, dir);
    this.log.push(['r', axis, dir]);
    this.undoFloor = this.mine.length; // moves before a rotation can't be undone (they'd turn the wrong layer now)
    return { ok: true };
  }
}

/** Your moves in face-turn metric: R R = R2 counts once, R R' cancels. */
export function faceTurns(moves) {
  const out = [];
  for (const [a, l, d] of moves) {
    const top = out[out.length - 1];
    if (top && top.a === a && top.l === l) {
      top.q = (top.q + d + 4) % 4;
      if (top.q === 0) out.pop();
    } else out.push({ a, l, q: (d + 4) % 4 });
  }
  return out;
}

/**
 * Daily scramble: everyone gets the same 3x3 state; fewest moves wins
 * (score = 1000 − face turns). The scramble isn't shown – you solve the cube
 * itself – and a solve that is just the scramble backwards scores nothing.
 */
export class CubeDaily extends CubeFree {
  constructor(seed) { super(seed, 3); this.daily = true; }
  get htm() { return faceTurns(this.mine).length; }
  get reversedScramble() {
    const mine = faceTurns(this.mine), inv = faceTurns(this.scrambleRaw.slice().reverse().map(inverse));
    return mine.length === inv.length && mine.every((m, i) => m.a === inv[i].a && m.l === inv[i].l && m.q === inv[i].q);
  }
  get score() { return this.solved && !this.reversedScramble ? Math.max(1, 1000 - this.htm) : 0; }
}
function replayDaily(seed, log) {
  const sim = new CubeDaily(seed);
  for (const a of log) {
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    let r;
    if (typeof a === 'number') { const t = decodeTwist(sim.cube.layers, a); r = t ? sim.twist(...t) : { ok: false }; }
    else if (Array.isArray(a) && a[0] === 'q') { sim.quit(); r = { ok: true }; }
    else if (Array.isArray(a) && a[0] === 'u') r = sim.undo();
    else if (Array.isArray(a) && a[0] === 'r') r = sim.rotate(a[1], a[2]);
    else return { ok: false, reason: 'unknown action', sim };
    if (!r.ok) return { ok: false, reason: 'invalid action', sim };
  }
  return { ok: true, sim };
}
export const scrambleGame = {
  id: 'scramble',
  title: 'Daily Scramble',
  icon: '🧊',
  tagline: 'Same 3×3 scramble for everyone – fewest moves wins',
  color: ['#ff8a65', '#283593'],
  maxLog: 3000,
  shellsPer: 40,
  milestone: 900,
  special: true,
  firstTry: true,
  create: (seed) => new CubeDaily(seed),
  replay: replayDaily,
};

export default {
  id: 'cube',
  title: 'Cube Twist',
  icon: '🧊',
  tagline: 'Solve the 3D twisty cube – 2×2 to full scrambles',
  color: ['#ff8a65', '#283593'],
  maxLog: 15000,
  shellsPer: 120,
  milestone: 4000,
  create: (seed) => new CubeRun(seed),
  replay,
};
export { CubeRun, inverse };

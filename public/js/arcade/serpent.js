// Sea Serpent – classic snake on a 15 x 19 reef. Pure & deterministic.
// The world advances in fixed ticks (60/s); the serpent moves every
// `interval` ticks, which shrinks as it grows. Inputs are logged as
// ['t', tick, dir] and buffered (max 2) so quick double-turns work.
// Shrimp +10, golden pearls (appear for a few seconds) +50. Every 5 shrimp a
// rock drops onto the reef. Walls, rocks and your own tail end the run.
// Dash ['b', tick]: costs your last segment, doubles your speed for 2 s and
// shrimp eaten while dashing are worth +10 more.

import { Rng } from '../rng.js';

export const COLS = 15;
export const ROWS = 19;
const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const OPP = { u: 'd', d: 'u', l: 'r', r: 'l' };
const PEARL_TICKS = 60 * 6;
export const DASH_TICKS = 120;

class SerpentSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = new Rng(seed);
    this.tick = 0;
    this.started = false;
    this.over = false;
    this.overReason = '';
    const cy = Math.floor(ROWS / 2);
    this.body = [[4, cy], [3, cy], [2, cy]]; // head first
    this.dir = 'r';
    this.queue = [];
    this.rocks = [];
    this.eaten = 0;
    this.pearls = 0;
    this.points = 0;
    this.log = [];
    this.events = [];
    this.nextMove = 0;
    this.dashUntil = 0;
    this.lastMove = 0;
    this.moveGap = 10;
    this.prev = this.body.map((c) => c.slice());
    this.food = this.freeCell();
    this.pearl = null; // { x, y, until }
  }

  get score() {
    return this.points;
  }

  get interval() {
    const base = Math.max(4, 10 - Math.floor(this.eaten / 4));
    return this.dashing ? Math.max(2, Math.floor(base / 2)) : base;
  }
  get dashing() {
    return this.tick < this.dashUntil;
  }

  /** Dash: spend your tail for a burst of speed. */
  dash() {
    if (this.over || !this.started || this.dashing || this.body.length <= 4) return false;
    this.log.push(['b', this.tick]);
    this.body.pop();
    this.prev = this.prev.slice(0, this.body.length);
    this.dashUntil = this.tick + DASH_TICKS;
    this.events.push('dash');
    return true;
  }

  occupied(x, y) {
    return this.body.some(([bx, by]) => bx === x && by === y) || this.rocks.some(([rx, ry]) => rx === x && ry === y);
  }

  freeCell() {
    const free = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (!this.occupied(x, y) && !(this.food && this.food[0] === x && this.food[1] === y) && !(this.pearl && this.pearl.x === x && this.pearl.y === y)) free.push([x, y]);
    return free.length ? this.rng.pick(free) : null;
  }

  turn(dir) {
    if (this.over || !DIRS[dir]) return false;
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (dir === last || dir === OPP[last] || this.queue.length >= 2) return false;
    this.log.push(['t', this.tick, dir]);
    this.queue.push(dir);
    if (!this.started) { this.started = true; this.nextMove = this.tick + 1; }
    return true;
  }

  start() {
    if (this.started || this.over) return;
    this.log.push(['s', this.tick]);
    this.started = true;
    this.nextMove = this.tick + 1;
  }

  quit() {
    if (this.over) return;
    this.log.push(['q', this.tick]);
    this.over = true;
    this.overReason = 'Cashed out';
  }

  step() {
    this.events = [];
    if (this.over || !this.started) return;
    this.tick++;
    if (this.pearl && this.tick >= this.pearl.until) { this.pearl = null; this.events.push('pearlGone'); }
    if (this.tick < this.nextMove) return;
    this.moveGap = this.interval;
    this.nextMove = this.tick + this.moveGap;
    this.lastMove = this.tick;
    this.prev = this.body.map((c) => c.slice());
    if (this.queue.length) this.dir = this.queue.shift();
    const [hx, hy] = this.body[0];
    const [dx, dy] = DIRS[this.dir];
    const nx = hx + dx, ny = hy + dy;
    const eating = this.food && this.food[0] === nx && this.food[1] === ny;
    // moving into the current tail cell is fine unless we're growing
    const tail = this.body[this.body.length - 1];
    const hitsSelf = this.body.some(([bx, by], i) => bx === nx && by === ny && !(i === this.body.length - 1 && !eating && tail));
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return this.die('Bumped the reef wall!');
    if (this.rocks.some(([rx, ry]) => rx === nx && ry === ny)) return this.die('Crashed into a rock!');
    if (hitsSelf) return this.die('Tied yourself in a knot!');
    this.body.unshift([nx, ny]);
    this.events.push('move');
    if (eating) {
      this.eaten++;
      this.points += 10 + Math.floor(this.eaten / 10) * 2 + (this.dashing ? 10 : 0);
      this.events.push('eat');
      this.food = this.freeCell();
      if (this.eaten % 5 === 0) {
        const r = this.rockCell();
        if (r) { this.rocks.push(r); this.events.push('rock'); }
      }
      if (!this.pearl && this.eaten % 3 === 0 && this.rng.next() < 0.6) {
        const c = this.freeCell();
        if (c) { this.pearl = { x: c[0], y: c[1], until: this.tick + PEARL_TICKS }; this.events.push('pearl'); }
      }
    } else {
      this.body.pop();
    }
    if (this.pearl && this.pearl.x === nx && this.pearl.y === ny) {
      this.pearls++;
      this.points += 50;
      this.pearl = null;
      this.events.push('gotPearl');
    }
    if (!this.food) this.die('The reef is full – amazing!');
  }

  // rocks never land right in front of the head
  rockCell() {
    const [hx, hy] = this.body[0];
    for (let i = 0; i < 30; i++) {
      const c = this.freeCell();
      if (!c) return null;
      if (Math.abs(c[0] - hx) + Math.abs(c[1] - hy) > 3) return c;
    }
    return null;
  }

  die(reason) {
    this.over = true;
    this.overReason = reason;
    this.events.push('die');
  }
}

function replay(seed, log) {
  const sim = new SerpentSim(seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    if (a[1] > 216000) return { ok: false, reason: 'run too long', sim }; // 1 hour of play
    while (sim.tick < a[1] && !sim.over && sim.started) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 't') { if (!sim.turn(a[2])) return { ok: false, reason: 'invalid turn', sim }; }
    else if (a[0] === 's') sim.start();
    else if (a[0] === 'b') { if (!sim.dash()) return { ok: false, reason: 'bad dash', sim }; }
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  for (let i = 0; i < 2000000 && !sim.over; i++) sim.step();
  return { ok: true, sim };
}

export default {
  id: 'serpent',
  title: 'Sea Serpent',
  icon: '🐍',
  tagline: 'Eat shrimp, grow long, don’t bite your tail',
  color: ['#26a69a', '#004d40'],
  maxLog: 20000,
  shellsPer: 25,
  milestone: 500,
  create: (seed) => new SerpentSim(seed),
  replay,
};
export { SerpentSim };

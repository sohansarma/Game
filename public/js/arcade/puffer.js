// Puffer Dash – tap to swim up through gaps in the coral. Pure &
// deterministic: the world advances in fixed ticks (60 per second) and the
// only input is "flap" at a given tick, so a run is just a list of ticks.
//
// World is 100 x 160 units. Score = 10 per coral passed + 5 per pearl.
// After 20 corals some gaps start to sway, after 40 some are narrow
// "squeeze" gaps worth double.

import { Rng } from '../rng.js';

export const WORLD_W = 100;
export const WORLD_H = 160;
export const FLOOR = 150;
const PX = 30; // puffer x
const R = 5; // puffer radius
const PIPE_W = 16;
const SPACING = 62;
const GRAVITY = 0.13;
const FLAP_V = -2.4;
const MAX_FALL = 3.8;

class PufferSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = new Rng(seed);
    this.added = 0;
    this.tick = 0;
    this.y = 80;
    this.vy = 0;
    this.started = false;
    this.over = false;
    this.overReason = '';
    this.passed = 0;
    this.pearls = 0;
    this.speed = 1.0;
    this.pipes = [];
    this.log = [];
    this.pending = false;
    this.events = [];
    let x = WORLD_W + 40;
    for (let i = 0; i < 4; i++) { this.addPipe(x); x += SPACING; }
  }

  get score() {
    return this.passed * 10 + this.pearls * 5;
  }

  get gap() {
    return Math.max(40, 54 - this.passed * 0.35);
  }

  addPipe(x) {
    const gap = this.gap;
    const margin = 18 + gap / 2;
    const gy = margin + this.rng.next() * (FLOOR - 2 * margin);
    const pearl = this.rng.next() < 0.35;
    const roll = this.rng.next();
    const n = this.added++;
    // variety once you've found your rhythm: swaying gaps, then squeezes
    let kind = 'plain', amp = 0, phase = 0, g2 = gap;
    if (n >= 20 && roll < 0.35) { kind = 'sway'; amp = Math.min(14, margin - 12); phase = this.rng.next() * 6.28; }
    else if (n >= 40 && roll < 0.5) { kind = 'squeeze'; g2 = Math.max(34, gap - 8); }
    this.pipes.push({ x, gy, base: gy, amp, phase, kind, gap: g2, scored: false, pearl, pearlTaken: false });
  }

  flap() {
    if (this.over) return false;
    this.log.push(['f', this.tick]);
    this.started = true;
    this.pending = true;
    return true;
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
    if (this.pending) { this.vy = FLAP_V; this.pending = false; this.events.push('flap'); }
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY);
    this.y += this.vy;
    this.speed = Math.min(1.9, 1.0 + this.tick * 0.00025);
    for (const p of this.pipes) {
      p.x -= this.speed;
      if (p.amp) p.gy = p.base + p.amp * Math.sin(this.tick / 40 + p.phase);
    }
    if (this.pipes[0].x < -PIPE_W) {
      this.pipes.shift();
      this.addPipe(this.pipes[this.pipes.length - 1].x + SPACING);
    }
    for (const p of this.pipes) {
      if (!p.scored && p.x + PIPE_W < PX - R) {
        p.scored = true;
        this.passed++;
        if (p.kind === 'squeeze') this.pearls += 2; // a squeeze is worth double
        this.events.push(p.kind === 'squeeze' ? 'squeeze' : 'pass');
      }
      if (p.pearl && !p.pearlTaken) {
        const dx = p.x + PIPE_W / 2 - PX, dy = p.gy - this.y;
        if (dx * dx + dy * dy < (R + 3) * (R + 3)) { p.pearlTaken = true; this.pearls++; this.events.push('pearl'); }
      }
      if (this.hits(p)) return this.die('Bonk!');
    }
    if (this.y + R >= FLOOR) return this.die('Hit the sand!');
    if (this.y - R <= 0) { this.y = R; this.vy = 0; }
  }

  hits(p) {
    if (PX + R < p.x || PX - R > p.x + PIPE_W) return false;
    const top = p.gy - p.gap / 2, bottom = p.gy + p.gap / 2;
    // closest point on the pipe rectangles to the circle centre
    const cx = Math.max(p.x, Math.min(PX, p.x + PIPE_W));
    if (this.y - R < top) {
      const cy = Math.min(this.y, top);
      const dx = PX - cx, dy = this.y - cy;
      if (dx * dx + dy * dy < R * R || this.y < top) return true;
    }
    if (this.y + R > bottom) {
      const cy = Math.max(this.y, bottom);
      const dx = PX - cx, dy = this.y - cy;
      if (dx * dx + dy * dy < R * R || this.y > bottom) return true;
    }
    return false;
  }

  die(reason) {
    this.over = true;
    const medal = this.passed >= 50 ? ' 🥇 Gold medal' : this.passed >= 25 ? ' 🥈 Silver medal' : this.passed >= 10 ? ' 🥉 Bronze medal' : '';
    this.overReason = reason + medal;
    this.events.push('die');
  }
}

function replay(seed, log) {
  const sim = new PufferSim(seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    if (a[1] > 216000) return { ok: false, reason: 'run too long', sim }; // 1 hour of play
    while (sim.tick < a[1] && !sim.over && sim.started) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 'f') sim.flap();
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  for (let i = 0; i < 2000000 && !sim.over; i++) sim.step();
  return { ok: true, sim };
}

export default {
  id: 'puffer',
  title: 'Puffer Dash',
  icon: '🐡',
  tagline: 'Tap to swim through the coral',
  color: ['#4dd0e1', '#01579b'],
  maxLog: 30000,
  shellsPer: 15,
  milestone: 300,
  create: (seed) => new PufferSim(seed),
  replay,
};
export { PufferSim, PX, R, PIPE_W };

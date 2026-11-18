// Reef Tower – tap to drop a sliding slab onto the tower. Overhang is cut
// off; a perfect drop keeps the full width and builds a streak (every 3rd
// perfect in a row grows the slab back a little). Miss completely and the
// run ends. Pure & deterministic: fixed 60 ticks/s, input = drop tick.
// Score = 10 per floor + streak bonus for perfect drops.

export const WORLD_W = 100;
const START_W = 60;
const PERFECT = 1.4;
const NEAR = 3; // "almost perfect": snaps into place, but no streak
// The climb has zones that change how the slab moves.
export const ZONES = [
  { from: 0, name: 'Reef', icon: '🪸', tip: 'Calm water' },
  { from: 15, name: 'Currents', icon: '🌊', tip: 'The slab surges and slows' },
  { from: 30, name: 'Windy surface', icon: '🌬️', tip: 'Fast with the wind, slow against it' },
  { from: 45, name: 'Starlight', icon: '✨', tip: 'Smooth, fast and quiet' },
];
export const zoneAt = (floors) => [...ZONES].reverse().find((z) => floors >= z.from);

class StackSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.started = false;
    this.over = false;
    this.overReason = '';
    this.tower = [{ x: (WORLD_W - START_W) / 2, w: START_W }];
    this.floors = 0;
    this.perfects = 0;
    this.streak = 0;
    this.bonus = 0;
    this.log = [];
    this.events = [];
    this.cut = null;
    this.spawn();
  }

  get score() {
    return this.floors * 10 + this.bonus;
  }

  get speed() {
    // gentle ramp, with a seed-dependent wobble so dailies differ
    return Math.min(2.7, 0.95 + this.floors * 0.045 + ((this.seed >> (this.floors % 24)) & 1) * 0.12);
  }

  spawn() {
    const top = this.tower[this.tower.length - 1];
    const fromLeft = (this.floors + (this.seed & 1)) % 2 === 0;
    this.cur = { w: top.w, x: fromLeft ? -15 : WORLD_W - top.w + 15, dir: fromLeft ? 1 : -1 };
  }

  start() {
    if (this.started || this.over) return;
    this.log.push(['s', this.tick]);
    this.started = true;
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
    const c = this.cur;
    let v = this.speed;
    const zone = zoneAt(this.floors).name;
    if (zone === 'Currents') v *= 1 + 0.45 * Math.sin(this.tick / 18 + (this.seed % 628) / 100);
    else if (zone === 'Windy surface') v *= c.dir === ((((this.seed >> 3) + (this.floors >> 1)) & 1) ? 1 : -1) ? 1.35 : 0.7;
    c.x += c.dir * v;
    const lo = -15, hi = WORLD_W - c.w + 15;
    if (c.x < lo) { c.x = lo + (lo - c.x); c.dir = 1; }
    if (c.x > hi) { c.x = hi - (c.x - hi); c.dir = -1; }
  }

  drop() {
    if (this.over) return { ok: false };
    if (!this.started) { this.start(); return { ok: true, started: true }; }
    this.log.push(['d', this.tick]);
    const top = this.tower[this.tower.length - 1];
    const c = this.cur;
    this.events = [];
    let x = c.x, w = c.w, perfect = false, near = false;
    const off = Math.abs(c.x - top.x);
    if (off > PERFECT && off <= NEAR && c.w <= top.w + 0.01) {
      // so close: snap it on, keep the width, but the perfect streak ends
      near = true;
      x = top.x;
      this.streak = 0;
      this.cut = null;
    } else if (off <= PERFECT) {
      perfect = true;
      x = top.x;
      this.streak++;
      this.perfects++;
      this.bonus += Math.min(25, 5 * this.streak);
      if (this.streak % 3 === 0) w = Math.min(START_W, w + 4);
      this.cut = null;
    } else {
      this.streak = 0;
      const left = Math.max(c.x, top.x);
      const right = Math.min(c.x + c.w, top.x + top.w);
      if (right - left <= 0.5) {
        this.over = true;
        this.overReason = `Missed! Your tower is ${this.floors} floors tall`;
        this.cut = { x: c.x, w: c.w, y: this.tower.length };
        this.events.push('miss');
        return { ok: true, miss: true };
      }
      this.cut = c.x < top.x ? { x: c.x, w: top.x - c.x, y: this.tower.length } : { x: right, w: c.x + c.w - right, y: this.tower.length };
      x = left;
      w = right - left;
    }
    this.tower.push({ x, w });
    this.floors++;
    const before = zoneAt(this.floors - 1);
    this.events.push(perfect ? 'perfect' : near ? 'near' : 'place');
    this.spawn();
    const zone = zoneAt(this.floors);
    return { ok: true, perfect, near, zone: zone !== before ? zone : null };
  }
}

function replay(seed, log) {
  const sim = new StackSim(seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    if (a[1] > 216000) return { ok: false, reason: 'run too long', sim }; // 1 hour of play
    while (sim.tick < a[1] && !sim.over && sim.started) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 's') sim.start();
    else if (a[0] === 'd') sim.drop();
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  // a run only ends by missing a drop or cashing out
  if (!sim.over) return { ok: false, reason: 'game not finished', sim };
  return { ok: true, sim };
}

export default {
  id: 'stack',
  title: 'Reef Tower',
  icon: '🗼',
  tagline: 'Tap to stack – perfect drops keep it wide',
  color: ['#ffab91', '#4a148c'],
  maxLog: 6000,
  shellsPer: 20,
  milestone: 600,
  create: (seed) => new StackSim(seed),
  replay,
};
export { StackSim };

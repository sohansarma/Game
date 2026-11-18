// Crab Catch – a 60-second whack-a-crab frenzy. Pure & deterministic
// (60 ticks/s). Things pop out of 12 burrows on a seeded schedule; inputs
// are ['t', tick, hole] taps. Crab +10 x combo, golden crab +50 x combo,
// jellyfish -20 and breaks the combo, clock +3 s. Tapping an empty burrow
// also breaks the combo. Combo (x1..x5) grows every 3 hits in a row.

import { Rng } from '../rng.js';

export const HOLES = 12;
export const GAME_TICKS = 60 * 60;
// Burrows pop on a beat: eighth notes at 120 BPM (15 ticks) speeding to ~150 BPM (12 ticks).
export const eighthAt = (tick) => (tick < GAME_TICKS * 0.5 ? 15 : tick < GAME_TICKS * 0.8 ? 13 : 12);
export const FEVER_TICKS = 300;

class CatchSim {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.tick = 0;
    this.started = false;
    this.over = false;
    this.overReason = '';
    this.timeLeft = GAME_TICKS;
    this.holes = new Array(HOLES).fill(null);
    this.points = 0;
    this.streak = 0;
    this.hits = 0;
    this.misses = 0;
    this.nextSpawn = 30;
    this.feverUntil = 0;
    this.onBeat = 0;
    this.log = [];
    this.events = [];
  }

  get score() {
    return Math.max(0, this.points);
  }
  get combo() {
    return Math.min(5, 1 + Math.floor(this.streak / 3));
  }
  get fever() {
    return this.tick < this.feverUntil;
  }

  start() {
    if (this.started || this.over) return false;
    this.log.push(['s', this.tick]);
    this.started = true;
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
    this.timeLeft--;
    const progress = Math.min(1, this.tick / GAME_TICKS);
    for (let i = 0; i < HOLES; i++) {
      const h = this.holes[i];
      if (h && this.tick >= h.until) {
        if (h.kind === 'crab' || h.kind === 'gold') { this.streak = 0; this.events.push({ kind: 'escape', hole: i }); }
        this.holes[i] = null;
      }
    }
    if (this.tick >= this.nextSpawn) {
      const free = [];
      for (let i = 0; i < HOLES; i++) if (!this.holes[i]) free.push(i);
      const count = progress > 0.5 && this.rng.next() < 0.35 ? 2 : 1;
      for (let n = 0; n < count && free.length; n++) {
        const idx = free.splice(this.rng.int(free.length), 1)[0];
        const roll = this.rng.next();
        let kind = roll < 0.07 ? 'gold' : roll < 0.22 + progress * 0.08 ? 'jelly' : roll < 0.26 + progress * 0.08 ? 'clock' : 'crab';
        if (kind === 'jelly' && this.fever) kind = 'crab'; // fever: no jellyfish
        const stay = Math.round((kind === 'gold' ? 42 : 75) - progress * 30);
        this.holes[idx] = { kind, born: this.tick, until: this.tick + stay };
        this.events.push({ kind: 'spawn', hole: idx, what: kind });
      }
      // next spawn snaps to the beat grid
      const e = eighthAt(this.tick);
      const gap = Math.max(12, Math.round(38 - progress * 24 + this.rng.int(10)));
      this.nextSpawn = Math.ceil((this.tick + gap) / e) * e;
    }
    if (this.timeLeft <= 0) {
      this.over = true;
      this.overReason = `Time's up! ${this.hits} catches`;
      this.events.push({ kind: 'end' });
    }
  }

  tap(i) {
    if (this.over || !this.started || !Number.isInteger(i) || i < 0 || i >= HOLES) return { ok: false };
    this.log.push(['t', this.tick, i]);
    const h = this.holes[i];
    this.holes[i] = null;
    if (!h) { this.streak = 0; this.misses++; return { ok: true, what: 'miss' }; }
    if (h.kind === 'crab' || h.kind === 'gold') {
      this.streak++;
      this.hits++;
      // on the beat (within 3 ticks of an eighth note): +5 bonus
      const e = eighthAt(this.tick), off = Math.min(this.tick % e, e - (this.tick % e));
      const beat = off <= 3;
      if (beat) this.onBeat++;
      let pts = ((h.kind === 'gold' ? 50 : 10) + (beat ? 5 : 0)) * this.combo;
      if (this.fever) pts *= 2;
      this.points += pts;
      // reaching x5 lights a 5-second fever (once per streak climb)
      let feverStart = false;
      if (this.streak === 12 && !this.fever) { this.feverUntil = this.tick + FEVER_TICKS; feverStart = true; }
      return { ok: true, what: h.kind, pts, beat, feverStart };
    }
    if (h.kind === 'jelly') {
      this.streak = 0;
      this.points -= 20;
      return { ok: true, what: 'jelly', pts: -20 };
    }
    this.timeLeft += 180;
    return { ok: true, what: 'clock' };
  }
}

function replay(seed, log) {
  const sim = new CatchSim(seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    if (a[1] > 216000) return { ok: false, reason: 'run too long', sim };
    while (sim.tick < a[1] && !sim.over && sim.started) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 's') { if (!sim.start()) return { ok: false, reason: 'bad start', sim }; }
    else if (a[0] === 't') { if (!sim.tap(a[2]).ok) return { ok: false, reason: 'bad tap', sim }; }
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  for (let i = 0; i < 216000 && !sim.over && sim.started; i++) sim.step();
  if (!sim.over) return { ok: false, reason: 'game not finished', sim };
  return { ok: true, sim };
}

export default {
  id: 'catch',
  title: 'Crab Catch',
  icon: '🦀',
  tagline: '60 seconds. Catch crabs, dodge jellies!',
  color: ['#ffd180', '#bf360c'],
  maxLog: 6000,
  shellsPer: 40,
  milestone: 1500,
  create: (seed) => new CatchSim(seed),
  replay,
};
export { CatchSim };

// Tidepop Maker – the engine behind player-made games.
//
// A creation is plain data (a "spec"): a template plus themed items and rule
// sliders. No creator code ever runs. Every template is a pure,
// deterministic simulation at 60 ticks/s, so runs can be replayed to verify
// leaderboard scores exactly like the built-in arcade games.
//
// World: 100 x 150 units. Inputs are logged as [kind, tick, ...].

import { Rng } from '../rng.js';

export const WW = 100;
export const WH = 150;
export const SPEC_VERSION = 1;

// Emoji palette creators can pick from (keeps creations friendly & safe).
export const EMOJI = {
  heroes: ['🐡', '🐢', '🦀', '🐙', '🐬', '🦈', '🐳', '🐠', '🦭', '🐧', '🦦', '🐸', '🐱', '🐶', '🦊', '🐼', '🐵', '🦄', '🤖', '🚀', '🛸', '⛵', '🚗', '🧺', '🪣', '🥅', '🧙', '🦸', '🐝', '🦋'],
  items: ['🐚', '⭐', '💎', '🪙', '🍎', '🍓', '🍩', '🍪', '🍕', '🎁', '🍀', '❤️', '🌈', '🫧', '🦐', '🐟', '🍌', '🍉', '🥕', '🎈', '🔔', '⚽', '🏀', '📦', '🪐', '🌸', '🍄', '🧁', '🍭', '🔮'],
  hazards: ['🪼', '💣', '🌵', '🔥', '⚡', '☠️', '🦂', '🕷️', '🐍', '🌪️', '🧨', '🪨', '🦑', '👻', '🌋', '🧊', '🗑️', '🦟', '🐝', '☄️'],
};
export const PALETTES = [
  ['#4fc3f7', '#0d47a1'], ['#ff8a65', '#4e342e'], ['#81c784', '#1b5e20'], ['#ba68c8', '#311b92'],
  ['#ffd54f', '#e65100'], ['#90a4ae', '#263238'], ['#f48fb1', '#880e4f'], ['#4dd0e1', '#004d40'],
];

export const TEMPLATES = {
  catch: {
    name: 'Catcher', icon: '🧺', blurb: 'Slide left & right to catch the good stuff falling from above – dodge the hazards.',
    rules: { speed: 3, spawn: 3, lives: 3, ramp: 2, missHurts: 0, size: 3 },
  },
  flap: {
    name: 'Flapper', icon: '🪽', blurb: 'Tap to fly up through gaps between hazards. Grab goodies in the gaps.',
    rules: { speed: 3, gravity: 3, gap: 3, lives: 1, ramp: 2, spawn: 3 },
  },
  tap: {
    name: 'Tapper', icon: '👆', blurb: 'Things pop up – tap the good ones fast, never the hazards. Beat the clock!',
    rules: { speed: 3, spawn: 3, lives: 3, duration: 60, ramp: 2, size: 3 },
  },
  arena: {
    name: 'Arena', icon: '🌀', blurb: 'Steer your hero around the arena collecting goodies while hazards bounce around.',
    rules: { speed: 3, spawn: 3, lives: 3, ramp: 2, enemies: 3, size: 3 },
  },
};

export const RULE_INFO = {
  speed: { label: 'Speed', min: 1, max: 5 },
  spawn: { label: 'Spawn rate', min: 1, max: 5 },
  lives: { label: 'Lives', min: 1, max: 5 },
  ramp: { label: 'Gets harder', min: 0, max: 5 },
  missHurts: { label: 'Missing a goodie costs a life', min: 0, max: 1 },
  size: { label: 'Item size', min: 1, max: 5 },
  gravity: { label: 'Gravity', min: 1, max: 5 },
  gap: { label: 'Gap size', min: 1, max: 5 },
  duration: { label: 'Time limit (s)', min: 20, max: 180, step: 10 },
  enemies: { label: 'Hazards at start', min: 1, max: 8 },
};

// ---------------------------------------------------------------- validation
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigg', 'fag', 'slut', 'whore', 'rape', 'nazi', 'kill yourself', 'kys', 'porn', 'sex', 'cock', 'bastard', 'asshole', 'retard'];
export function cleanText(s, max) {
  let t = String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const low = t.toLowerCase().replace(/[^a-z ]/g, '');
  if (BAD_WORDS.some((w) => low.includes(w))) return null;
  return t;
}
const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** Returns a clean spec or throws an Error explaining the problem. */
export function sanitize(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('Not a game');
  const tpl = TEMPLATES[spec.template];
  if (!tpl) throw new Error('Pick a template');
  const title = cleanText(spec.title, 30);
  if (title === null) throw new Error('Please choose a friendlier title');
  if (!title || title.length < 3) throw new Error('Give your game a title (3–30 characters)');
  const description = cleanText(spec.description, 160);
  if (description === null) throw new Error('Please keep the description friendly');
  const pick = (list, v, d) => (list.includes(v) ? v : d);
  const goods = (Array.isArray(spec.good) ? spec.good : []).slice(0, 3).map((g) => ({ e: pick(EMOJI.items, g?.e, '⭐'), pts: clampInt(g?.pts, 1, 100, 10) }));
  const bads = (Array.isArray(spec.bad) ? spec.bad : []).slice(0, 3).map((b) => ({ e: pick(EMOJI.hazards, b?.e, '💣') }));
  if (!goods.length) throw new Error('Add at least one goodie');
  if (!bads.length && spec.template !== 'catch') throw new Error('Add at least one hazard');
  const rules = {};
  for (const [k, d] of Object.entries(tpl.rules)) {
    const info = RULE_INFO[k];
    let v = clampInt(spec.rules?.[k], info.min, info.max, d);
    if (info.step) v = Math.round(v / info.step) * info.step;
    rules[k] = v;
  }
  const palette = clampInt(spec.palette, 0, PALETTES.length - 1, 0);
  const out = { sv: SPEC_VERSION, template: spec.template, title, description: description || '', hero: pick(EMOJI.heroes, spec.hero, tpl === TEMPLATES.flap ? '🐡' : '🧺'), good: goods, bad: bads, rules, palette };
  // credit for remixes (shown on the card) and the weekly jam entry tag
  if (spec.remix && /^[a-z0-9]{8}$/.test(spec.remix.id)) {
    out.remix = { id: spec.remix.id, title: cleanText(spec.remix.title, 30) || 'a game', owner: cleanText(spec.remix.owner, 40) || 'a creator' };
  }
  if (typeof spec.jam === 'string' && /^\d{4}-W\d{2}$/.test(spec.jam)) out.jam = spec.jam;
  return out;
}

// One theme per week – a small prompt for creators, entries get their own shelf.
export const JAM_THEMES = ['🐙 Eight arms', '🌙 Night swim', '🍩 Sweet treats', '⚡ Speed demons', '👻 Spooky reef', '🎵 Rhythm of the tide', '🧊 Frozen sea', '🌈 Rainbow reef', '🐢 Slow and steady', '💎 Treasure hunt', '🌋 Hot water', '🎈 Floaty'];
export function jamTheme(week) {
  let h = 0;
  for (const c of String(week)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return JAM_THEMES[h % JAM_THEMES.length];
}

export function starterSpec(template) {
  const t = TEMPLATES[template];
  return {
    template,
    title: '',
    description: '',
    hero: { catch: '🧺', flap: '🐡', tap: '🦀', arena: '🐙' }[template],
    good: [{ e: '⭐', pts: 10 }, { e: '💎', pts: 25 }],
    bad: [{ e: { catch: '💣', flap: '🪨', tap: '🪼', arena: '🦈' }[template] }],
    rules: { ...t.rules },
    palette: 0,
  };
}

// ---------------------------------------------------------------- simulation
class MakerSim {
  constructor(spec, seed) {
    this.spec = spec;
    this.rng = new Rng(seed);
    this.r = spec.rules;
    this.tick = 0;
    this.started = spec.template !== 'flap';
    this.over = false;
    this.overReason = '';
    this.points = 0;
    this.lives = spec.rules.lives || 1;
    this.log = [];
    this.events = [];
    this.objs = [];
    this.nextId = 1;
    this.hx = WW / 2;
    this.hy = spec.template === 'arena' ? WH / 2 : spec.template === 'flap' ? 70 : 135;
    this.target = [this.hx, this.hy];
    this.vy = 0;
    this.invuln = 0;
    this.spawnAt = 30;
    this.timeLeft = spec.template === 'tap' ? spec.rules.duration * 60 : 0;
    if (spec.template === 'arena') for (let i = 0; i < spec.rules.enemies; i++) this.spawnHazard();
    if (spec.template === 'flap') { this.nextGapX = WW + 30; for (let i = 0; i < 3; i++) this.addGap(); }
  }

  get score() { return Math.max(0, this.points); }
  get level() { return 1 + Math.floor(this.tick / (60 * 15)); }
  get mult() { return 1 + (this.r.ramp || 0) * 0.06 * (this.level - 1); }
  itemR() { return 3 + (this.r.size || 3) * 0.9; }

  // ---------------- input
  input(x, y) {
    if (this.over) return false;
    const tx = Math.max(0, Math.min(WW, Math.round(x))), ty = Math.max(0, Math.min(WH, Math.round(y)));
    if (tx === this.target[0] && ty === this.target[1]) return false;
    this.log.push(['x', this.tick, tx, ty]);
    this.target = [tx, ty];
    return true;
  }
  flap() {
    if (this.over) return false;
    this.log.push(['f', this.tick]);
    this.started = true;
    this.vy = -1.15 - (this.r.gravity || 3) * 0.17;
    return true;
  }
  tap(x, y) {
    if (this.over) return { ok: false };
    const tx = Math.round(x), ty = Math.round(y);
    this.log.push(['t', this.tick, tx, ty]);
    let hit = null, bestD = this.itemR() + 4;
    for (const o of this.objs) {
      const d = Math.hypot(o.x - tx, o.y - ty);
      if (d < bestD) { bestD = d; hit = o; }
    }
    if (!hit) { this.events.push({ kind: 'miss', x: tx, y: ty }); return { ok: true }; }
    this.objs.splice(this.objs.indexOf(hit), 1);
    if (hit.good) this.gain(hit);
    else this.hurt(hit);
    return { ok: true };
  }
  quit() {
    if (this.over) return;
    this.log.push(['q', this.tick]);
    this.over = true;
    this.overReason = 'Cashed out';
  }

  // ---------------- helpers
  gain(o) {
    this.points += o.pts;
    this.events.push({ kind: 'good', x: o.x, y: o.y, pts: o.pts, e: o.e });
  }
  hurt(o) {
    if (this.invuln > 0) return;
    this.lives--;
    this.invuln = 45;
    this.events.push({ kind: 'bad', x: o.x, y: o.y, e: o.e });
    if (this.lives <= 0) this.end(`Out of lives! Reached level ${this.level}`);
  }
  end(reason) {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.events.push({ kind: 'end' });
  }
  pickGood() { return this.rng.pick(this.spec.good); }
  spawnHazard() {
    const b = this.rng.pick(this.spec.bad);
    const a = this.rng.next() * Math.PI * 2;
    // spawn away from the hero
    let x, y, guard = 0;
    do { x = 8 + this.rng.next() * (WW - 16); y = 8 + this.rng.next() * (WH - 16); } while (Math.hypot(x - this.hx, y - this.hy) < 35 && guard++ < 20);
    this.objs.push({ id: this.nextId++, good: false, e: b.e, x, y, vx: Math.cos(a), vy: Math.sin(a) });
  }
  addGap() {
    const gap = 30 + (this.r.gap || 3) * 6 - Math.min(14, (this.level - 1) * (this.r.ramp || 0) * 0.8);
    const margin = 14 + gap / 2;
    const gy = margin + this.rng.next() * (WH - 12 - 2 * margin);
    const b = this.rng.pick(this.spec.bad);
    this.objs.push({ id: this.nextId++, kind: 'wall', x: this.nextGapX, gy, gap, e: b.e, scored: false });
    if (this.rng.next() < 0.5 + (this.r.spawn || 3) * 0.08) {
      const g = this.pickGood();
      this.objs.push({ id: this.nextId++, good: true, e: g.e, pts: g.pts, x: this.nextGapX, y: gy });
    }
    this.nextGapX += 70 - (this.r.spawn || 3) * 4;
  }

  // ---------------- tick
  step() {
    this.events = [];
    if (this.over || !this.started) return;
    this.tick++;
    if (this.invuln > 0) this.invuln--;
    const sp = (0.45 + (this.r.speed || 3) * 0.22) * this.mult;
    const R = this.itemR();
    switch (this.spec.template) {
      case 'catch': {
        const d = this.target[0] - this.hx;
        this.hx += Math.max(-2.6, Math.min(2.6, d));
        if (this.tick >= this.spawnAt) {
          const bad = this.spec.bad.length && this.rng.next() < 0.28 + Math.min(0.2, (this.level - 1) * 0.02 * (this.r.ramp || 0));
          const src = bad ? this.rng.pick(this.spec.bad) : this.pickGood();
          this.objs.push({ id: this.nextId++, good: !bad, e: src.e, pts: src.pts, x: 6 + this.rng.next() * (WW - 12), y: -5, vy: sp * (0.8 + this.rng.next() * 0.5) });
          this.spawnAt = this.tick + Math.max(8, Math.round((70 - (this.r.spawn || 3) * 10) / this.mult) + this.rng.int(15));
        }
        for (const o of this.objs) o.y += o.vy;
        const caught = this.objs.filter((o) => Math.abs(o.x - this.hx) < R + 7 && o.y > this.hy - 7 && o.y < this.hy + 5);
        for (const o of caught) { o.dead = true; o.good ? this.gain(o) : this.hurt(o); }
        for (const o of this.objs) if (!o.dead && o.y > WH + 6) { o.dead = true; if (o.good && this.r.missHurts) this.hurt(o); }
        this.objs = this.objs.filter((o) => !o.dead);
        break;
      }
      case 'flap': {
        this.vy = Math.min(3, this.vy + 0.045 + (this.r.gravity || 3) * 0.016);
        this.hy += this.vy;
        const scroll = sp * 1.1;
        for (const o of this.objs) o.x -= scroll;
        for (const o of this.objs) {
          if (o.kind === 'wall') {
            if (!o.scored && o.x + 8 < 30) { o.scored = true; this.points += 5; this.events.push({ kind: 'pass' }); }
            const inX = Math.abs(o.x - 30) < 8 + 4;
            if (inX && (this.hy - 4 < o.gy - o.gap / 2 || this.hy + 4 > o.gy + o.gap / 2)) this.hurt({ x: 30, y: this.hy, e: o.e });
          } else if (!o.dead && Math.hypot(o.x - 30, o.y - this.hy) < R + 4) { o.dead = true; this.gain(o); }
        }
        if (this.hy > WH - 4 || this.hy < 2) { this.hurt({ x: 30, y: this.hy, e: '💥' }); this.hy = Math.max(10, Math.min(WH - 10, this.hy)); this.vy = 0; }
        this.objs = this.objs.filter((o) => !o.dead && o.x > -20);
        const walls = this.objs.filter((o) => o.kind === 'wall');
        const rightmost = walls.length ? Math.max(...walls.map((o) => o.x)) : WW;
        if (rightmost < WW + 10) { this.nextGapX = rightmost + 70 - (this.r.spawn || 3) * 4; this.addGap(); }
        break;
      }
      case 'tap': {
        this.timeLeft--;
        if (this.tick >= this.spawnAt) {
          const bad = this.rng.next() < 0.25;
          const src = bad ? this.rng.pick(this.spec.bad) : this.pickGood();
          const life = Math.max(30, Math.round((130 - (this.r.speed || 3) * 15) / this.mult));
          this.objs.push({ id: this.nextId++, good: !bad, e: src.e, pts: src.pts, x: 10 + this.rng.next() * (WW - 20), y: 20 + this.rng.next() * (WH - 40), until: this.tick + life, born: this.tick });
          this.spawnAt = this.tick + Math.max(10, Math.round((60 - (this.r.spawn || 3) * 8) / this.mult) + this.rng.int(12));
        }
        this.objs = this.objs.filter((o) => o.until > this.tick);
        if (this.timeLeft <= 0) this.end("Time's up!");
        break;
      }
      case 'arena': {
        const dx = this.target[0] - this.hx, dy = this.target[1] - this.hy, dist = Math.hypot(dx, dy);
        const max = 1.2 + (this.r.speed || 3) * 0.25;
        if (dist > 0.5) { this.hx += (dx / dist) * Math.min(max, dist); this.hy += (dy / dist) * Math.min(max, dist); }
        for (const o of this.objs) {
          if (o.good) continue;
          o.x += o.vx * sp; o.y += o.vy * sp;
          if (o.x < 4 || o.x > WW - 4) o.vx = -o.vx;
          if (o.y < 4 || o.y > WH - 4) o.vy = -o.vy;
          o.x = Math.max(4, Math.min(WW - 4, o.x)); o.y = Math.max(4, Math.min(WH - 4, o.y));
        }
        if (!this.objs.some((o) => o.good) || (this.tick >= this.spawnAt && this.objs.filter((o) => o.good).length < 3)) {
          const g = this.pickGood();
          this.objs.push({ id: this.nextId++, good: true, e: g.e, pts: g.pts, x: 8 + this.rng.next() * (WW - 16), y: 8 + this.rng.next() * (WH - 16) });
          this.spawnAt = this.tick + Math.max(30, 200 - (this.r.spawn || 3) * 30);
        }
        if (this.tick % Math.max(240, 900 - (this.r.ramp || 0) * 120) === 0 && this.objs.filter((o) => !o.good).length < 14) this.spawnHazard();
        for (const o of this.objs) {
          if (Math.hypot(o.x - this.hx, o.y - this.hy) < R + 4) {
            if (o.good) { o.dead = true; this.gain(o); } else this.hurt(o);
          }
        }
        this.objs = this.objs.filter((o) => !o.dead);
        break;
      }
    }
  }
}

export function createSim(spec, seed) {
  return new MakerSim(spec, seed >>> 0);
}

export function replay(spec, seed, log) {
  const sim = createSim(spec, seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last || a[1] > 216000) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    while (sim.tick < a[1] && !sim.over && sim.started) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 'x') sim.input(a[2], a[3]);
    else if (a[0] === 'f') sim.flap();
    else if (a[0] === 't') sim.tap(a[2], a[3]);
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  for (let i = 0; i < 216000 && !sim.over && sim.started; i++) sim.step();
  if (!sim.over) return { ok: false, reason: 'game not finished', sim };
  return { ok: true, sim };
}

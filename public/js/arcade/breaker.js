// Coral Breaker – brick breaker. Pure & deterministic (fixed 60 ticks/s).
// Inputs: ['x', tick, target] moves the paddle toward target x (the paddle
// has a max speed, so it can't teleport), ['l', tick] launches the ball.
// World 100 x 150. Bricks: 10 columns; tougher bricks take more hits.
// Power-ups: W = wide paddle, + = extra life, P = bonus pearl,
// M = multiball (two more pearls), S = sticky paddle (catch, aim, relaunch).
// The coral creeps down one row every 30 s you take on a wall.
// Score: brick hit 5, break 10 x level, pearl 50, level clear 100 x level.

import { Rng, hashString } from '../rng.js';

export const WW = 100;
export const WH = 150;
export const COLS = 10;
export const BRICK_H = 5;
export const BRICK_TOP = 16;
const PADDLE_Y = 140;
const BALL_R = 1.6;
const PADDLE_MAX = 2.6;

class BreakerSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.level = 0;
    this.points = 0;
    this.lives = 3;
    this.over = false;
    this.overReason = '';
    this.log = [];
    this.events = [];
    this.px = 50;
    this.target = 50;
    this.wideUntil = 0;
    this.stickyUntil = 0;
    this.extra = []; // multiball pearls: {bx, by, vx, vy}
    this.chain = 0; // breaks since the pearl last touched the paddle
    this.drops = [];
    this.nextLevel();
  }

  get score() {
    return this.points;
  }
  get paddleW() {
    return this.tick < this.wideUntil ? 30 : 20;
  }

  nextLevel() {
    this.level++;
    const rng = new Rng(hashString(`${this.seed}:breaker:${this.level}`));
    const rows = Math.min(9, 4 + this.level);
    this.bricks = [];
    const pattern = rng.int(4);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < COLS; c++) {
        let on = true;
        if (pattern === 1) on = (r + c) % 2 === 0 || r < 2;
        if (pattern === 2) on = Math.abs(c - 4.5) < rows - r + 1;
        if (pattern === 3) on = c !== 4 && c !== 5 || r % 2 === 0;
        if (!on) continue;
        const hp = Math.min(3, 1 + Math.floor((rows - 1 - r + this.level - 1) / 3) - (rng.next() < 0.3 ? 1 : 0)) || 1;
        const roll = rng.next();
        const drop = roll < 0.06 ? 'W' : roll < 0.09 ? '+' : roll < 0.13 ? 'M' : roll < 0.16 ? 'S' : roll < 0.24 ? 'P' : null;
        this.bricks.push({ r, c, hp, max: hp, drop });
      }
    this.levelTick = 0;
    this.resetBall();
  }

  resetBall() {
    this.extra = [];
    this.stickOff = 0;
    this.attached = true;
    this.speed = Math.min(2.6, 1.35 + this.level * 0.12);
    this.bx = this.px;
    this.by = PADDLE_Y - BALL_R - 1;
    this.vx = 0;
    this.vy = 0;
  }

  input(target) {
    if (this.over) return false;
    const t = Math.max(0, Math.min(WW, Math.round(target)));
    if (t === this.target) return false;
    this.log.push(['x', this.tick, t]);
    this.target = t;
    return true;
  }

  /** aim: -80..80 (percent sideways); omitted = the classic serve / sticky angle */
  launch(aim) {
    if (this.over || !this.attached) return false;
    const a = Number.isInteger(aim) ? Math.max(-80, Math.min(80, aim)) : null;
    this.log.push(a === null ? ['l', this.tick] : ['l', this.tick, a]);
    this.attached = false;
    // caught on a sticky paddle: launch at the angle where it sits
    const off = Math.max(-1, Math.min(1, this.stickOff / (this.paddleW / 2)));
    this.vx = a !== null ? this.speed * (a / 100) : this.stickOff ? this.speed * off * 0.8 : this.speed * 0.35;
    this.vy = -Math.sqrt(this.speed * this.speed - this.vx * this.vx);
    this.stickOff = 0;
    this.events.push('launch');
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
    if (this.over) return;
    this.tick++;
    // paddle
    const d = this.target - this.px;
    this.px += Math.max(-PADDLE_MAX, Math.min(PADDLE_MAX, d));
    const half = this.paddleW / 2;
    this.px = Math.max(half, Math.min(WW - half, this.px));
    // drops
    for (const p of this.drops) {
      p.y += 0.9;
      if (p.y >= PADDLE_Y - 1 && p.y <= PADDLE_Y + 3 && Math.abs(p.x - this.px) <= half + 2) {
        p.taken = true;
        if (p.kind === 'W') this.wideUntil = this.tick + 60 * 12;
        if (p.kind === '+') this.lives = Math.min(5, this.lives + 1);
        if (p.kind === 'P') this.points += 50;
        if (p.kind === 'S') this.stickyUntil = this.tick + 60 * 10;
        if (p.kind === 'M') {
          const src = this.attached ? { bx: this.px, by: PADDLE_Y - 8 } : { bx: this.bx, by: this.by };
          for (const a of [-0.6, 0.6]) if (this.extra.length < 4) this.extra.push({ bx: src.bx, by: src.by, vx: this.speed * a, vy: -Math.sqrt(this.speed * this.speed * (1 - a * a)) });
        }
        this.events.push('power:' + p.kind);
      }
    }
    this.drops = this.drops.filter((p) => !p.taken && p.y < WH);
    // the coral creeps down a row every 30 s (never closer than row 17)
    if (!this.attached) {
      this.levelTick++;
      if (this.levelTick % 1800 === 0 && this.bricks.length) {
        for (const b of this.bricks) b.r++;
        this.events.push('creep');
        // the coral reached your clam: lose a pearl, and it's pushed back up
        if (BRICK_TOP + (Math.max(...this.bricks.map((b) => b.r)) + 1) * BRICK_H >= PADDLE_Y - 6) {
          for (const b of this.bricks) b.r = Math.max(0, b.r - 5);
          this.lives--;
          this.events.push('crush');
          if (this.lives <= 0) { this.over = true; this.overReason = `The coral reached you! Level ${this.level}`; return; }
        }
      }
    }
    // extra pearls move first (they never cost a life)
    const steps = Math.ceil(this.speed / 1.2);
    if (this.extra.length) {
      const main = { bx: this.bx, by: this.by, vx: this.vx, vy: this.vy, attached: this.attached, lost: this.lostFlag };
      const lvl = this.level;
      for (const e of this.extra) {
        if (this.level !== lvl) break;
        Object.assign(this, { bx: e.bx, by: e.by, vx: e.vx, vy: e.vy, attached: false, lostFlag: false, extraBall: true });
        for (let i = 0; i < steps && !this.lostFlag && this.level === lvl; i++) this.moveBall(1 / steps);
        Object.assign(e, { bx: this.bx, by: this.by, vx: this.vx, vy: this.vy, gone: this.lostFlag });
      }
      this.extraBall = false;
      if (this.level !== lvl) return; // the wall was cleared by an extra pearl: fresh serve
      Object.assign(this, { bx: main.bx, by: main.by, vx: main.vx, vy: main.vy, attached: main.attached, lostFlag: false });
      this.extra = this.extra.filter((e) => !e.gone);
    }
    if (this.attached) { this.bx = this.px + this.stickOff; this.by = PADDLE_Y - BALL_R - 1; return; }
    // ball, in substeps
    for (let i = 0; i < steps && !this.over && !this.attached; i++) this.moveBall(1 / steps);
  }

  brickAt(x, y) {
    if (y < BRICK_TOP) return null;
    const r = Math.floor((y - BRICK_TOP) / BRICK_H);
    const c = Math.floor(x / (WW / COLS));
    return this.bricks.find((b) => b.r === r && b.c === c) || null;
  }

  hit(b) {
    b.hp--;
    this.points += 5;
    this.events.push('hit');
    if (b.hp <= 0) {
      this.bricks.splice(this.bricks.indexOf(b), 1);
      this.chain++;
      this.points += 10 * this.level + Math.min(20, (this.chain - 1) * 2);
      this.events.push('break');
      if (b.drop) this.drops.push({ kind: b.drop, x: (b.c + 0.5) * (WW / COLS), y: BRICK_TOP + (b.r + 0.5) * BRICK_H });
      this.speed = Math.min(3.2, this.speed + 0.01);
      if (!this.bricks.length) {
        this.points += 100 * this.level;
        this.events.push('clear');
        this.nextLevel();
      }
    }
  }

  moveBall(f) {
    // last few bricks: the pearl drifts gently towards the nearest one on the way up
    if (this.bricks.length && this.bricks.length <= 3 && this.vy < 0) {
      const bw = WW / COLS;
      let best = null;
      for (const b of this.bricks) { const dx = (b.c + 0.5) * bw - this.bx; if (best === null || Math.abs(dx) < Math.abs(best)) best = dx; }
      this.vx += Math.sign(best) * 0.012 * f;
      const sp = Math.hypot(this.vx, this.vy) || 1;
      this.vx *= this.speed / sp; this.vy *= this.speed / sp;
    }
    // x axis
    let nx = this.bx + this.vx * f;
    if (nx < BALL_R) { nx = BALL_R; this.vx = Math.abs(this.vx); this.events.push('wall'); }
    if (nx > WW - BALL_R) { nx = WW - BALL_R; this.vx = -Math.abs(this.vx); this.events.push('wall'); }
    const bxHit = this.brickAt(nx + Math.sign(this.vx) * BALL_R, this.by);
    if (bxHit) { this.vx = -this.vx; this.hit(bxHit); if (this.attached) return; } else this.bx = nx;
    // y axis
    let ny = this.by + this.vy * f;
    if (ny < BALL_R) { ny = BALL_R; this.vy = Math.abs(this.vy); this.events.push('wall'); }
    const byHit = this.brickAt(this.bx, ny + Math.sign(this.vy) * BALL_R);
    if (byHit) { this.vy = -this.vy; this.hit(byHit); if (this.attached) return; } else this.by = ny;
    // paddle
    const half = this.paddleW / 2;
    if (this.vy > 0 && this.by + BALL_R >= PADDLE_Y && this.by + BALL_R <= PADDLE_Y + 4 && Math.abs(this.bx - this.px) <= half + BALL_R) {
      const off = Math.max(-1, Math.min(1, (this.bx - this.px) / half));
      this.vx = this.speed * off * 0.8;
      // never straight up and down forever
      if (Math.abs(this.vx) < this.speed * 0.15) this.vx = this.speed * 0.15 * (this.tick % 2 ? 1 : -1);
      this.vy = -Math.sqrt(this.speed * this.speed - this.vx * this.vx);
      this.by = PADDLE_Y - BALL_R;
      this.chain = 0;
      this.events.push('paddle');
      // sticky paddle: the main pearl rests where it landed until you tap
      if (!this.extraBall && this.tick < this.stickyUntil) {
        this.attached = true;
        this.stickOff = this.bx - this.px;
        this.vx = 0; this.vy = 0;
        this.events.push('stick');
        return;
      }
    }
    if (this.by > WH + 4) {
      if (this.extraBall) { this.lostFlag = true; return; }
      // the main pearl fell but an extra one is still in play: it takes over
      if (this.extra.length) {
        const e = this.extra.shift();
        Object.assign(this, { bx: e.bx, by: e.by, vx: e.vx, vy: e.vy });
        this.events.push('drop-extra');
        return;
      }
      this.lives--;
      this.events.push('lost');
      if (this.lives <= 0) {
        this.over = true;
        this.overReason = `Out of pearls! Reached level ${this.level}`;
      } else this.resetBall();
    }
  }
}

function replay(seed, log) {
  const sim = new BreakerSim(seed);
  let last = -1;
  for (const a of log) {
    if (!Array.isArray(a) || !Number.isInteger(a[1]) || a[1] < last) return { ok: false, reason: 'bad action', sim };
    last = a[1];
    if (a[1] > 216000) return { ok: false, reason: 'run too long', sim };
    while (sim.tick < a[1] && !sim.over) sim.step();
    if (sim.over || sim.tick !== a[1]) return { ok: false, reason: 'input out of sync', sim };
    if (a[0] === 'x') { if (typeof a[2] !== 'number' || !sim.input(a[2])) return { ok: false, reason: 'bad input', sim }; }
    else if (a[0] === 'l') { if (a[2] !== undefined && !Number.isInteger(a[2])) return { ok: false, reason: 'bad aim', sim }; if (!sim.launch(a[2])) return { ok: false, reason: 'bad launch', sim }; }
    else if (a[0] === 'q') sim.quit();
    else return { ok: false, reason: 'unknown action', sim };
  }
  // after the last input the ball keeps bouncing until lives run out
  for (let i = 0; i < 216000 && !sim.over; i++) sim.step();
  if (!sim.over) return { ok: false, reason: 'game not finished', sim };
  return { ok: true, sim };
}

export default {
  id: 'breaker',
  title: 'Coral Breaker',
  icon: '💥',
  tagline: 'Bounce the pearl, smash the coral',
  color: ['#ff8a65', '#3e2723'],
  maxLog: 40000,
  shellsPer: 60,
  milestone: 3000,
  create: (seed) => new BreakerSim(seed),
  replay,
};
export { BreakerSim, PADDLE_Y, BALL_R };

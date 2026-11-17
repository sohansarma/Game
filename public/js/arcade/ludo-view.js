// Ludo board renderer + input. Works with the ranked LudoLeague (you are
// red vs 3 AI) and with 2-4 player human matches (pass & play / online):
// the sim exposes { game, canMove(), move(t) -> {ok, events}, mySide? }.
import { COLORS, START, SAFE, HOME, abs } from './ludo.js';
import { sfx, haptic } from '../audio.js';

const FILL = { red: '#ef5350', green: '#43a047', yellow: '#fbc02d', blue: '#1e88e5' };
const LIGHT = { red: '#ffcdd2', green: '#c8e6c9', yellow: '#fff59d', blue: '#bbdefb' };

// 52 main-track cells as [row, col], index 0 = red's start square
const TRACK = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];
const HOMECOL = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];
const BASE_ORIGIN = [[0, 0], [0, 9], [9, 9], [9, 0]];
const SLOTS = [[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]];
const HOME_SPOT = [[7, 6.25], [6.25, 7], [7, 7.75], [7.75, 7]];

export function cellOf(player, p, t) {
  if (p < 0) {
    const [r0, c0] = BASE_ORIGIN[player];
    return [r0 + SLOTS[t][0], c0 + SLOTS[t][1]];
  }
  if (p === HOME) return [HOME_SPOT[player][0] + 0.5 - 0.5, HOME_SPOT[player][1]];
  if (p > 50) { const [r, c] = HOMECOL[player][p - 51]; return [r + 0.5, c + 0.5]; }
  const [r, c] = TRACK[abs(player, p)];
  return [r + 0.5, c + 0.5];
}

export default class LudoView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.shown = sim.game.tokens.map((ts) => ts.slice());
    this.anim = null; // { player, token, path:[p...], step, t0 }
    this.queue = [];
    this.dice = { player: sim.game.turn, value: sim.game.roll, rolling: 0 };
    this.note = '';
    this.destroyed = false;
    this.resize();
    this.bind();
    this.renderControls();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  get game() {
    return this.sim.game;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const size = Math.min(rect.width, rect.height - 54);
    this.cell = size / 15;
    this.ox = (rect.width - size) / 2;
    this.oy = 4;
    this.W = rect.width;
    this.H = rect.height;
  }

  busy() {
    return !!this.anim || this.queue.length > 0;
  }

  bind() {
    const down = (e) => {
      if (this.busy() || !this.sim.canMove()) return;
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left - this.ox) / this.cell, y = (e.clientY - r.top - this.oy) / this.cell;
      const g = this.game, pl = g.turn;
      const legal = g.legal();
      let best = null, bestD = 0.9;
      for (const t of legal) {
        const [cy, cx] = cellOf(pl, g.tokens[pl][t], t);
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best === null && legal.length === 1) best = legal[0];
      if (best !== null) this.play(best);
    };
    const key = (e) => {
      if (document.querySelector('.modal.open') || this.busy() || !this.sim.canMove()) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && this.game.legal().includes(n - 1)) this.play(n - 1);
    };
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  play(t) {
    const res = this.sim.move(t);
    if (!res.ok) { sfx.bad(); return; }
    this.enqueue(res.events);
    if (res.end) this.queue.push({ kind: 'end', end: res.end });
    this.renderControls();
  }

  /** Online: events from the network after the opponent moved. */
  remoteEvents(events) {
    this.enqueue(events);
  }

  enqueue(events) {
    for (const e of events) this.queue.push(e);
  }

  nextEvent(now) {
    const e = this.queue.shift();
    if (!e) return;
    if (e.kind === 'roll') {
      this.dice = { player: e.player, value: e.value, rolling: now };
      sfx.tap();
    } else if (e.kind === 'move') {
      const path = [];
      if (e.from < 0) path.push(0);
      else for (let p = e.from + 1; p <= e.to; p++) path.push(p);
      this.anim = { player: e.player, token: e.token, path, step: 0, t0: now, captured: e.captured };
    } else if (e.kind === 'pass') {
      this.note = `${COLORS[e.player]} can't move`;
      this.wait = now + (this.reduced ? 150 : 450);
    } else if (e.kind === 'finish') {
      this.note = `${COLORS[e.player]} finished ${['', '1st', '2nd', '3rd', '4th'][e.place]}!`;
      sfx.win();
    } else if (e.kind === 'end') {
      // a new match may have started – resync
      this.shown = this.game.tokens.map((ts) => ts.slice());
      this.hooks.onRound?.(e.end, this.sim);
    }
  }

  loop(now) {
    if (this.destroyed) return;
    if (this.wait && now < this.wait) { /* pause */ } else {
      this.wait = 0;
      if (this.anim) {
        const a = this.anim;
        const stepMs = this.reduced ? 20 : 75;
        if (now - a.t0 >= stepMs) {
          this.shown[a.player][a.token] = a.path[a.step];
          a.step++;
          a.t0 = now;
          sfx.place();
          if (a.step >= a.path.length) {
            for (const c of a.captured) { this.shown[c.player][c.token] = -1; sfx.boom(); haptic(40); this.note = `${COLORS[a.player]} captured ${COLORS[c.player]}!`; }
            if (a.path[a.path.length - 1] === HOME) sfx.coin();
            this.anim = null;
            this.wait = now + (this.reduced ? 60 : 160);
          }
        }
      } else if (this.queue.length) {
        this.nextEvent(now);
        if (!this.anim && !this.wait) this.wait = now + (this.reduced ? 40 : 180);
      } else if (!this.synced) {
        this.shown = this.game.tokens.map((ts) => ts.slice());
        this.dice = { player: this.game.turn, value: this.game.roll, rolling: this.dice.rolling };
        this.synced = true;
        this.renderControls();
        this.hooks.onChange?.(this.sim);
        if (this.sim.over && !this.overSent) { this.overSent = true; setTimeout(() => this.hooks.onOver?.(this.sim), 600); }
      }
      if (this.busy()) this.synced = false;
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  renderControls() {
    const s = this.sim;
    const g = this.game;
    const yourTurn = s.canMove() && !this.busy();
    this.controls.innerHTML = `<div class="col" style="gap:6px;width:100%">
      <div class="small center">${this.note ? esc(this.note) + ' · ' : ''}${yourTurn ? `<b>${s.turnLabel ? s.turnLabel() : 'Your turn'}</b> – tap a glowing token` : s.waitLabel ? s.waitLabel() : 'Bots are playing…'}</div>
      ${s.resign ? `<button class="btn sm ghost" data-a="resign" ${s.over ? 'disabled' : ''}>🏳️ ${s.resignLabel || 'Leave'}</button>` : ''}</div>`;
    const b = this.controls.querySelector('[data-a="resign"]');
    if (b) b.onclick = () => this.hooks.onQuit?.();
    void g;
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    // board
    ctx.fillStyle = '#fffdf6';
    ctx.fillRect(0, 0, 15 * C, 15 * C);
    BASE_ORIGIN.forEach(([r, c], i) => {
      const col = COLORS[i];
      ctx.fillStyle = FILL[col];
      ctx.fillRect(c * C, r * C, 6 * C, 6 * C);
      ctx.fillStyle = '#fff';
      ctx.fillRect((c + 1) * C, (r + 1) * C, 4 * C, 4 * C);
      for (const [sr, sc] of SLOTS) {
        ctx.fillStyle = LIGHT[col];
        ctx.beginPath(); ctx.arc((c + sc) * C, (r + sr) * C, C * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      if (!g.players[i]) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(c * C, r * C, 6 * C, 6 * C); }
    });
    TRACK.forEach(([r, c], i) => {
      const startOf = START.indexOf(i);
      ctx.fillStyle = startOf >= 0 ? FILL[COLORS[startOf]] : '#fff';
      ctx.fillRect(c * C, r * C, C, C);
      ctx.strokeStyle = '#c9c2b0';
      ctx.lineWidth = 1;
      ctx.strokeRect(c * C, r * C, C, C);
      if (SAFE.has(i) && startOf < 0) {
        ctx.fillStyle = '#b0a58d';
        ctx.font = `${C * 0.7}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', (c + 0.5) * C, (r + 0.55) * C);
      }
    });
    HOMECOL.forEach((cells, i) => {
      for (const [r, c] of cells) {
        ctx.fillStyle = FILL[COLORS[i]];
        ctx.fillRect(c * C, r * C, C, C);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(c * C, r * C, C, C);
      }
    });
    // centre home triangles
    const tri = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0] * C, pts[0][1] * C); for (const p of pts.slice(1)) ctx.lineTo(p[0] * C, p[1] * C); ctx.fill(); };
    tri([[6, 6], [7.5, 7.5], [6, 9]], FILL.red);
    tri([[6, 6], [7.5, 7.5], [9, 6]], FILL.green);
    tri([[9, 6], [7.5, 7.5], [9, 9]], FILL.yellow);
    tri([[6, 9], [7.5, 7.5], [9, 9]], FILL.blue);
    // tokens
    const legal = this.sim.canMove() && !this.busy() ? g.legal() : [];
    const occupancy = new Map();
    const placed = [];
    this.shown.forEach((ts, pl) => {
      if (!g.players[pl]) return;
      ts.forEach((p, t) => {
        const [r, c] = cellOf(pl, p, t);
        const k = `${r.toFixed(2)},${c.toFixed(2)}`;
        const n = occupancy.get(k) || 0;
        occupancy.set(k, n + 1);
        placed.push({ pl, t, r, c, n });
      });
    });
    for (const tok of placed) {
      const stack = occupancy.get(`${tok.r.toFixed(2)},${tok.c.toFixed(2)}`);
      const off = stack > 1 ? (tok.n - (stack - 1) / 2) * C * 0.22 : 0;
      const x = tok.c * C + off, y = tok.r * C;
      const isLegal = tok.pl === g.turn && legal.includes(tok.t);
      const pulse = isLegal && !this.reduced ? 1 + 0.12 * Math.sin(now / 140) : 1;
      const R = C * 0.36 * pulse;
      if (isLegal) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(x, y, R + C * 0.12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(x, y + C * 0.06, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = FILL[COLORS[tok.pl]];
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = C * 0.08;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(x - R * 0.3, y - R * 0.3, R * 0.25, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // dice + turn banner under the board
    const by = this.oy + 15 * C + 8;
    const dcol = FILL[COLORS[this.dice.player]] || '#fff';
    const rolling = !this.reduced && now - this.dice.rolling < 280;
    const face = rolling ? 1 + Math.floor((now / 50) % 6) : this.dice.value;
    const ds = 38;
    const dx = this.W / 2 - ds / 2;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = dcol;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(dx, by, ds, ds, 8) : ctx.rect(dx, by, ds, ds);
    ctx.fill();
    ctx.stroke();
    const pips = { 1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]] };
    ctx.fillStyle = '#222';
    for (const [px, py] of pips[face] || []) { ctx.beginPath(); ctx.arc(dx + px * ds, by + py * ds, 3.6, 0, Math.PI * 2); ctx.fill(); }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Match', value: `🎲 ${sim.match}` },
    { label: 'Wins', value: `🏆 ${sim.wins}` },
  ];
}

export const HOW = `<div class="tip">🎲 You are <b>red</b>. The dice rolls for you – <b>tap a glowing token</b> to move it that many squares.</div>
<div class="tip">6️⃣ You need a <b>6</b> to bring a token out. A 6, a capture or getting a token home earns another roll (three 6s in a row lose the turn).</div>
<div class="tip">💥 Land on an opponent to send it back to base – except on ★ and coloured start squares, which are safe.</div>
<div class="tip">🏆 <b>League:</b> finish 1st or 2nd to advance to a match against smarter bots. 3rd or 4th ends your run. 1st = 300 × match, 2nd = 120 × match, plus captures.</div>`;

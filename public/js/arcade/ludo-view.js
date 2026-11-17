// Ludo table: rotating board (your colour sits bottom-left), a player
// panel with its own dice at every corner, tap-to-roll, token hops.
//
// sim interface: { game, mySide, canRoll(), canMove(), roll() -> {ok, events, end?},
//                  move(t) -> {ok, events, end?}, labelOf?(seat), isLocal?(seat) }
import { COLORS, START, SAFE, HOME, abs } from './ludo.js';
import { sfx, haptic } from '../audio.js';

const FILL = { red: '#e53935', green: '#43a047', yellow: '#fdd835', blue: '#1e88e5' };
const DARK = { red: '#b71c1c', green: '#1b5e20', yellow: '#c79a00', blue: '#0d47a1' };
const LIGHT = { red: '#ffcdd2', green: '#c8e6c9', yellow: '#fff9c4', blue: '#bbdefb' };

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
const HOME_SPOT = [[7.5, 6.4], [6.4, 7.5], [7.5, 8.6], [8.6, 7.5]];
const PIPS = { 1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]], 4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]] };

/** Board-space centre [row, col] of a token (unrotated). */
export function cellOf(player, p, t) {
  if (p < 0) { const [r0, c0] = BASE_ORIGIN[player]; return [r0 + SLOTS[t][0], c0 + SLOTS[t][1]]; }
  if (p === HOME) return HOME_SPOT[player];
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
    this.queue = [];
    this.anim = null;
    this.wait = 0;
    this.dice = sim.game.players.map(() => ({ value: 6, rollT0: 0 }));
    this.activeSeat = sim.game.turn;
    this.note = '';
    this.noteT = 0;
    this.destroyed = false;
    this.autoTimer = null;
    const ref = sim.mySide ?? sim.game.players.findIndex((p) => p === 'human');
    this.rot = (3 - Math.max(0, ref) + 4) % 4; // quarter turns so `ref` sits bottom-left
    this.resize();
    this.bind();
    this.renderControls();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.autoTimer);
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  get game() {
    return this.sim.game;
  }

  label(seat) {
    if (this.sim.labelOf) return this.sim.labelOf(seat);
    return seat === this.sim.mySide ? 'You' : `${COLORS[seat][0].toUpperCase()}${COLORS[seat].slice(1)} bot`;
  }
  isLocal(seat) {
    return this.sim.isLocal ? this.sim.isLocal(seat) : seat === this.sim.mySide;
  }

  // ---------------- layout
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.W = rect.width;
    this.H = rect.height;
    this.panelH = Math.min(64, Math.max(48, rect.height * 0.1));
    const size = Math.min(rect.width - 4, rect.height - this.panelH * 2 - 12);
    this.cell = size / 15;
    this.size = size;
    this.ox = (rect.width - size) / 2;
    this.oy = this.panelH + 6 + (rect.height - this.panelH * 2 - 12 - size) / 2;
  }

  /** Display corner (0 TL, 1 TR, 2 BR, 3 BL) of a seat after rotation. */
  cornerOf(seat) {
    return (seat + this.rot) % 4;
  }

  panelRect(seat) {
    const corner = this.cornerOf(seat);
    const w = Math.min(this.W / 2 - 8, 190), h = this.panelH;
    const x = corner === 0 || corner === 3 ? 4 : this.W - w - 4;
    const y = corner < 2 ? this.oy - h - 6 : this.oy + this.size + 6;
    return { x, y, w, h, right: corner === 1 || corner === 2 };
  }

  diceRect(seat) {
    const p = this.panelRect(seat);
    const d = p.h - 12;
    return { x: p.right ? p.x + 6 : p.x + p.w - d - 6, y: p.y + 6, s: d };
  }

  /** Rotate board-space [row, col] (0..15) into screen pixels. */
  toScreen(r, c) {
    let y = r, x = c;
    for (let i = 0; i < this.rot; i++) [y, x] = [x, 15 - y];
    return [this.ox + x * this.cell, this.oy + y * this.cell];
  }

  // ---------------- input
  bind() {
    const down = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.busy()) return;
      // dice
      const seat = this.game.turn;
      const d = this.diceRect(seat);
      const pr = this.panelRect(seat);
      if (this.sim.canRoll() && x >= pr.x && x <= pr.x + pr.w && y >= pr.y && y <= pr.y + pr.h) return this.doRoll();
      void d;
      if (!this.sim.canMove()) {
        if (this.sim.canRoll()) this.flashNote('Tap your dice to roll 🎲');
        return;
      }
      // token
      const legal = this.game.legal();
      let best = null, bestD = this.cell * 0.9;
      for (const t of legal) {
        const [cr, cc] = cellOf(seat, this.game.tokens[seat][t], t);
        const [sx, sy] = this.toScreen(cr, cc);
        const dist = Math.hypot(sx - x, sy - y);
        if (dist < bestD) { bestD = dist; best = t; }
      }
      if (best !== null) this.doMove(best);
    };
    const key = (e) => {
      if (document.querySelector('.modal.open') || this.busy()) return;
      if ((e.key === ' ' || e.key === 'Enter') && this.sim.canRoll()) { e.preventDefault(); this.doRoll(); }
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && this.sim.canMove() && this.game.legal().includes(n - 1)) this.doMove(n - 1);
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

  busy() {
    return !!this.anim || this.queue.length > 0 || performance.now() < this.wait;
  }

  doRoll() {
    const res = this.sim.roll();
    if (!res.ok) return;
    haptic(15);
    this.enqueue(res);
  }

  doMove(t) {
    clearTimeout(this.autoTimer);
    const res = this.sim.move(t);
    if (!res.ok) { sfx.bad(); return; }
    this.enqueue(res);
  }

  enqueue(res) {
    for (const e of res.events) this.queue.push(e);
    if (res.end) this.queue.push({ kind: 'end', end: res.end });
    this.renderControls();
  }

  /** Online: events from the other device. */
  remoteEvents(events) {
    for (const e of events) this.queue.push(e);
  }

  flashNote(text) {
    this.note = text;
    this.noteT = performance.now();
    this.renderControls();
  }

  // ---------------- event playback
  nextEvent(now) {
    const e = this.queue.shift();
    const slow = this.reduced ? 0.3 : 1;
    switch (e.kind) {
      case 'roll':
        this.activeSeat = e.player;
        this.dice[e.player] = { value: e.value, rollT0: now };
        sfx.dice ? sfx.dice() : sfx.tap();
        this.wait = now + 650 * slow;
        if (e.value === 6 && this.isLocal(e.player)) haptic(25);
        break;
      case 'move': {
        const path = [];
        if (e.from < 0) path.push(0);
        else for (let p = e.from + 1; p <= e.to; p++) path.push(p);
        this.anim = { player: e.player, token: e.token, path, step: 0, t0: now, captured: e.captured };
        break;
      }
      case 'pass':
        this.flashNote(`${this.label(e.player)}: no move possible`);
        this.wait = now + 500 * slow;
        break;
      case 'three6':
        this.flashNote(`Three 6s in a row – ${this.label(e.player)} loses the turn!`);
        sfx.bad();
        this.wait = now + 700 * slow;
        break;
      case 'bonus':
        if (this.isLocal(e.player)) this.flashNote('🎲 Roll again!');
        break;
      case 'turn':
        this.activeSeat = e.player;
        this.renderControls();
        this.wait = now + 200 * slow;
        break;
      case 'finish':
        this.flashNote(`🏆 ${this.label(e.player)} finished ${['', '1st', '2nd', '3rd', '4th'][e.place]}!`);
        sfx.win();
        this.wait = now + 900 * slow;
        break;
      case 'end':
        this.shown = this.game.tokens.map((ts) => ts.slice());
        this.activeSeat = this.game.turn;
        this.hooks.onRound?.(e.end, this.sim);
        break;
      default:
    }
  }

  loop(now) {
    if (this.destroyed) return;
    if (now >= this.wait) {
      if (this.anim) {
        const a = this.anim;
        const stepMs = this.reduced ? 25 : 150;
        if (now - a.t0 >= stepMs) {
          this.shown[a.player][a.token] = a.path[a.step];
          a.step++;
          a.t0 = now;
          sfx.place();
          if (a.step >= a.path.length) {
            for (const c of a.captured) {
              this.shown[c.player][c.token] = -1;
              sfx.boom();
              haptic(50);
              this.flashNote(`💥 ${this.label(a.player)} captured ${this.label(c.player)}!`);
            }
            if (a.path[a.path.length - 1] === HOME) { sfx.coin(); this.flashNote(`🏠 ${this.label(a.player)} got a token home!`); }
            this.anim = null;
            this.wait = now + (this.reduced ? 60 : 260);
          }
        }
      } else if (this.queue.length) {
        this.nextEvent(now);
      } else if (!this.settled) {
        this.settled = true;
        this.shown = this.game.tokens.map((ts) => ts.slice());
        this.activeSeat = this.game.turn;
        this.renderControls();
        this.hooks.onChange?.(this.sim);
        if (this.sim.over && !this.overSent) { this.overSent = true; setTimeout(() => this.hooks.onOver?.(this.sim), 700); }
        this.maybeAutoMove();
      }
      if (this.anim || this.queue.length) this.settled = false;
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  // Like real Ludo apps: if there's only one sensible move, make it.
  maybeAutoMove() {
    if (!this.sim.canMove()) return;
    const g = this.game, seat = g.turn;
    const legal = g.legal();
    const distinct = new Set(legal.map((t) => g.tokens[seat][t]));
    if (distinct.size === 1) this.autoTimer = setTimeout(() => { if (!this.busy() && this.sim.canMove()) this.doMove(legal[0]); }, this.reduced ? 120 : 380);
  }

  renderControls() {
    const s = this.sim, g = this.game;
    const fresh = this.note && performance.now() - this.noteT < 4000;
    let status;
    if (s.over || g.over) status = 'Game over';
    else if (this.busy()) status = `${esc(this.label(this.activeSeat))} ${this.activeSeat === s.mySide ? 'are' : 'is'} playing…`;
    else if (s.canRoll()) status = `<b>${this.isLocal(g.turn) && s.mySide === undefined ? `${this.label(g.turn)}'s turn – ` : 'Your turn – '}tap your dice 🎲</b>`;
    else if (s.canMove()) status = `<b>Rolled ${g.roll} – tap a glowing token</b>`;
    else status = `${this.label(g.turn)} is playing…`;
    this.controls.innerHTML = `<div class="col" style="gap:6px;width:100%">
      <div class="small center">${fresh ? `${esc(this.note)}<br>` : ''}${status}</div>
      ${s.resign ? `<button class="btn sm ghost" data-a="resign" ${s.over ? 'disabled' : ''}>🏳️ ${s.resignLabel || 'Leave table'}</button>` : ''}</div>`;
    const b = this.controls.querySelector('[data-a="resign"]');
    if (b) b.onclick = () => this.hooks.onQuit?.();
  }

  // ---------------- drawing
  drawDie(x, y, s, value, color, glow, now, t0) {
    const ctx = this.ctx;
    const rolling = !this.reduced && now - t0 < 600;
    const face = rolling ? 1 + Math.floor(((now - t0) / 70 + value) % 6) : value;
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    if (rolling) {
      const k = (now - t0) / 600;
      ctx.rotate(Math.sin(k * 14) * 0.5 * (1 - k));
      ctx.translate(0, -Math.abs(Math.sin(k * 9)) * s * 0.25 * (1 - k));
    } else if (glow && !this.reduced) {
      const b = Math.abs(Math.sin(now / 260));
      ctx.scale(1 + b * 0.06, 1 + b * 0.06);
    }
    if (glow) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 14; }
    ctx.fillStyle = '#fff';
    roundedRect(ctx, -s / 2, -s / 2, s, s, s * 0.2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = '#1b1b2f';
    for (const [px, py] of PIPS[face]) {
      ctx.beginPath();
      ctx.arc(-s / 2 + px * s, -s / 2 + py * s, s * 0.085, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawPanels(now) {
    const ctx = this.ctx, g = this.game;
    g.players.forEach((pl, seat) => {
      if (!pl) return;
      const p = this.panelRect(seat);
      const col = COLORS[seat];
      const active = seat === this.activeSeat && !g.over;
      ctx.save();
      ctx.fillStyle = active ? FILL[col] : 'rgba(10,30,70,0.55)';
      ctx.strokeStyle = FILL[col];
      ctx.lineWidth = active ? 3 : 2;
      roundedRect(ctx, p.x, p.y, p.w, p.h, 14);
      ctx.fill();
      ctx.stroke();
      // avatar
      const ax = p.right ? p.x + p.w - p.h / 2 - 4 : p.x + p.h / 2 + 4;
      ctx.fillStyle = active ? '#fff' : FILL[col];
      ctx.beginPath(); ctx.arc(ax, p.y + p.h / 2, p.h * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = active ? FILL[col] : '#fff';
      ctx.font = `${p.h * 0.32}px system-ui, "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.isLocal(seat) ? '🙂' : pl === 'ai' ? '🤖' : '👤', ax, p.y + p.h / 2 + 1);
      // name + status
      const home = g.tokens[seat].filter((x) => x === HOME).length;
      const place = g.finished.indexOf(seat);
      ctx.fillStyle = active && col === 'yellow' ? '#3b2a00' : '#fff';
      ctx.textAlign = p.right ? 'right' : 'left';
      const tx = p.right ? ax - p.h * 0.42 : ax + p.h * 0.42;
      ctx.font = `800 ${Math.min(14, p.h * 0.26)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillText(this.label(seat), tx, p.y + p.h * 0.36);
      ctx.font = `600 ${Math.min(12, p.h * 0.22)}px system-ui, sans-serif`;
      ctx.fillText(place >= 0 ? `🏆 ${['1st', '2nd', '3rd', '4th'][place]}` : `🏠 ${home}/4`, tx, p.y + p.h * 0.68);
      ctx.restore();
      // dice
      if (place < 0) {
        const d = this.diceRect(seat);
        const canTap = active && this.sim.canRoll() && this.isLocal(seat) && !this.busy();
        this.drawDie(d.x, d.y, d.s, this.dice[seat].value, DARK[col], canTap, now, this.dice[seat].rollT0);
        if (canTap) {
          ctx.fillStyle = '#fff';
          ctx.font = '800 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          const below = this.cornerOf(seat) >= 2;
          ctx.fillText('TAP!', d.x + d.s / 2, below ? d.y - 6 : d.y + d.s + 12);
        }
      }
    });
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawPanels(now);
    // board, drawn unrotated then rotated about its centre
    ctx.save();
    ctx.translate(this.ox + this.size / 2, this.oy + this.size / 2);
    ctx.rotate((this.rot * Math.PI) / 2);
    ctx.translate(-this.size / 2, -this.size / 2);
    ctx.fillStyle = '#fffdf6';
    roundedRect(ctx, -3, -3, 15 * C + 6, 15 * C + 6, 10);
    ctx.fill();
    BASE_ORIGIN.forEach(([r, c], i) => {
      const col = COLORS[i];
      ctx.fillStyle = FILL[col];
      ctx.fillRect(c * C, r * C, 6 * C, 6 * C);
      ctx.fillStyle = '#fff';
      roundedRect(ctx, (c + 0.8) * C, (r + 0.8) * C, 4.4 * C, 4.4 * C, C * 0.6);
      ctx.fill();
      for (const [sr, sc] of SLOTS) {
        ctx.fillStyle = LIGHT[col];
        ctx.beginPath(); ctx.arc((c + sc) * C, (r + sr) * C, C * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = FILL[col];
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (!g.players[i]) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(c * C, r * C, 6 * C, 6 * C); }
    });
    TRACK.forEach(([r, c], i) => {
      const startOf = START.indexOf(i);
      ctx.fillStyle = startOf >= 0 ? FILL[COLORS[startOf]] : '#fff';
      ctx.fillRect(c * C, r * C, C, C);
      ctx.strokeStyle = '#cfc8b6';
      ctx.lineWidth = 1;
      ctx.strokeRect(c * C, r * C, C, C);
      if (SAFE.has(i)) {
        ctx.fillStyle = startOf >= 0 ? 'rgba(255,255,255,0.85)' : '#b0a58d';
        ctx.font = `${C * 0.62}px system-ui`;
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
    const tri = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0] * C, pts[0][1] * C); for (const q of pts.slice(1)) ctx.lineTo(q[0] * C, q[1] * C); ctx.fill(); };
    tri([[6, 6], [7.5, 7.5], [6, 9]], FILL.red);
    tri([[6, 6], [7.5, 7.5], [9, 6]], FILL.green);
    tri([[9, 6], [7.5, 7.5], [9, 9]], FILL.yellow);
    tri([[6, 9], [7.5, 7.5], [9, 9]], FILL.blue);
    ctx.restore();

    // tokens (drawn in screen space so they stay upright)
    const legal = this.sim.canMove() && !this.busy() ? g.legal() : [];
    const groups = new Map();
    const placed = [];
    this.shown.forEach((ts, pl) => {
      if (!g.players[pl]) return;
      ts.forEach((p, t) => {
        const [r, c] = cellOf(pl, p, t);
        const k = `${r.toFixed(2)},${c.toFixed(2)}`;
        const n = groups.get(k) || 0;
        groups.set(k, n + 1);
        placed.push({ pl, t, r, c, n, k });
      });
    });
    placed.sort((a, b) => (a.pl === g.turn) - (b.pl === g.turn));
    for (const tok of placed) {
      const stack = groups.get(tok.k);
      let [x, y] = this.toScreen(tok.r, tok.c);
      if (stack > 1) { x += (tok.n - (stack - 1) / 2) * C * 0.26; y -= tok.n * C * 0.06; }
      const isLegal = tok.pl === g.turn && legal.includes(tok.t);
      const bounce = isLegal && !this.reduced ? Math.abs(Math.sin(now / 180)) * C * 0.18 : 0;
      this.drawToken(x, y - bounce, C * 0.38, COLORS[tok.pl], isLegal);
    }

    // centre-board banner
    if (this.note && performance.now() - this.noteT < 1600) {
      const t = (performance.now() - this.noteT) / 1600;
      ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      ctx.fillStyle = 'rgba(10,20,50,0.82)';
      const w = Math.min(this.W - 20, 300);
      roundedRect(ctx, this.W / 2 - w / 2, this.oy + this.size / 2 - 20, w, 40, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.note, this.W / 2, this.oy + this.size / 2, w - 16);
      ctx.globalAlpha = 1;
    }
  }

  drawToken(x, y, R, col, glow) {
    const ctx = this.ctx;
    if (glow) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(x, y, R * 1.32, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x, y + R * 0.75, R * 0.85, R * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    // pawn: base + head
    const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.5, R * 0.1, x, y, R * 1.2);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.35, FILL[col]);
    g.addColorStop(1, DARK[col]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y + R * 0.45, R * 0.85, R * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - R * 0.55, y + R * 0.45);
    ctx.quadraticCurveTo(x - R * 0.3, y - R * 0.2, x - R * 0.22, y - R * 0.35);
    ctx.lineTo(x + R * 0.22, y - R * 0.35);
    ctx.quadraticCurveTo(x + R * 0.3, y - R * 0.2, x + R * 0.55, y + R * 0.45);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - R * 0.55, R * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, R * 0.12);
    ctx.stroke();
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Table', value: `🎲 ${sim.match}` },
    { label: 'Wins', value: `🏆 ${sim.wins}` },
  ];
}

export const HOW = `<div class="tip">🎲 <b>Tap your dice</b> to roll, then <b>tap a glowing token</b> to move it. If there's only one possible move, it moves by itself.</div>
<div class="tip">6️⃣ You need a <b>6</b> to bring a token out. A 6, a capture or getting a token home gives you <b>another roll</b> – but three 6s in a row lose your turn!</div>
<div class="tip">💥 Land on an opponent to send it back to base – except on ★ safe squares. Reach home with the exact number.</div>
<div class="tip">🏆 <b>League:</b> pick your colour and face 3 bots. Finish 1st or 2nd to move to a tougher table; 3rd or 4th ends your run.</div>`;

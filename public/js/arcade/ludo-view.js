// Ludo table: rotating board (your colour sits bottom-left), a name tag per
// seat and ONE shared dice tray at the bottom centre. Every throw slides from
// the thrower's tag into the tray, so the dice is always in the same place.
//
// sim interface: { game, mySide, canRoll(), canMove(), roll() -> {ok, events, end?},
//                  move(t) -> {ok, events, end?}, labelOf?(seat), isLocal?(seat) }
import { COLORS, START, SAFE, HOME, abs } from './ludo.js';
import { sfx, haptic } from '../audio.js';
import { woodTexture, softShadow, drawDie as drawDie3D, throwPose } from './table.js';

const FILL = { red: '#d62f2f', green: '#2e8b3e', yellow: '#f5b800', blue: '#1b62c4' };
const DARK = { red: '#8e1414', green: '#17521f', yellow: '#a87a00', blue: '#0c3678' };
const LIGHT = { red: '#f7c5c0', green: '#c4e3c4', yellow: '#fbe7a6', blue: '#bfd3f2' };

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
    this.die = { value: 6, rollT0: 0, seat: sim.game.turn };
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
    this.panelH = 54;
    this.trayS = 54;
    const avail = Math.min(rect.width - 6, rect.height - this.panelH * 2 - 20 - 60); // 60: message strip under the table
    this.frame = Math.max(8, Math.round(avail * 0.028));
    // whole device pixels per square, so every grid line is crisp and even
    const snap = (v) => Math.round(v * dpr) / dpr;
    this.cell = Math.floor(((avail - this.frame * 2) / 15) * dpr) / dpr;
    const size = this.cell * 15;
    this.size = size;
    this.ox = snap((rect.width - size) / 2);
    this.oy = snap(this.panelH + 10 + this.frame + Math.max(0, (rect.height - this.panelH * 2 - 20 - 60 - (size + this.frame * 2)) / 2));
  }

  /** Display corner (0 TL, 1 TR, 2 BR, 3 BL) of a seat after rotation. */
  cornerOf(seat) {
    return (seat + this.rot) % 4;
  }

  /** The name tag in front of each seat, on the table above/below the board. */
  panelRect(seat) {
    const corner = this.cornerOf(seat);
    const gap = this.trayS + 20; // the dice tray sits between the two bottom tags
    const w = Math.min((this.W - gap) / 2 - 8, 172), h = this.panelH;
    const x = corner === 0 || corner === 3 ? this.W / 2 - gap / 2 - w : this.W / 2 + gap / 2;
    const y = corner < 2 ? this.oy - this.frame - h - 8 : this.oy + this.size + this.frame + 8;
    return { x, y, w, h, right: corner === 1 || corner === 2 };
  }

  /** The one dice tray everybody throws into (bottom centre, under the board). */
  trayRect() {
    const S = this.trayS;
    const y = this.oy + this.size + this.frame + 8 + (this.panelH - S) / 2;
    return { x: this.W / 2 - S / 2, y, s: S };
  }

  /** Where the dice rests (same for every seat). */
  diceRect() {
    const t = this.trayRect();
    const d = Math.round(t.s * 0.56);
    return { x: t.x + (t.s - d) / 2, y: t.y + (t.s - d) / 2, s: d };
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
      const seat = this.game.turn;
      if (this.sim.canRoll()) {
        const t = this.trayRect(), pr = this.panelRect(seat), pad = 14;
        const onTray = x >= t.x - pad && x <= t.x + t.s + pad && y >= t.y - pad && y <= t.y + t.s + pad;
        const onTag = x >= pr.x - 6 && x <= pr.x + pr.w + 6 && y >= pr.y - 6 && y <= pr.y + pr.h + 6;
        if (onTray || onTag) return this.doRoll();
        this.flashNote('Tap the dice to roll 🎲');
        return;
      }
      if (!this.sim.canMove()) return;
      const t = this.tokenAt(x, y);
      if (t !== null) this.doMove(t);
      else this.flashNote('Tap a glowing token');
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

  /** Which of the current player's legal tokens is under (x, y)? The whole
   *  pawn counts (base and head), with a forgiving radius. */
  tokenAt(x, y) {
    const g = this.game, seat = g.turn, legal = g.legal();
    if (!legal.length) return null;
    let best = null, bestD = Infinity;
    for (const it of this.tokenLayout()) {
      if (it.pl !== seat || !legal.includes(it.t)) continue;
      const head = it.y - it.R * 0.95;
      const d = Math.min(Math.hypot(it.x - x, it.y - y), Math.hypot(it.x - x, head - y), Math.abs(it.x - x) < it.R && y > head && y < it.y ? 0 : Infinity);
      if (d < bestD) { bestD = d; best = it.t; }
    }
    return bestD <= this.cell * 1.05 ? best : null;
  }

  /** Screen position and size of every token (stacked tokens share a square). */
  tokenLayout() {
    const C = this.cell, g = this.game;
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
    const SPREAD = {
      1: [[0, 0]],
      2: [[-0.2, 0], [0.2, 0]],
      3: [[-0.22, -0.1], [0.22, -0.1], [0, 0.16]],
      4: [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]],
    };
    const SCALE = { 1: 1, 2: 0.78, 3: 0.68, 4: 0.62 };
    return placed.map((tok) => {
      const stack = Math.min(4, groups.get(tok.k));
      let [x, y] = this.toScreen(tok.r, tok.c);
      const [dx, dy] = SPREAD[stack][Math.min(tok.n, 3)];
      x += dx * C; y += dy * C;
      return { ...tok, x, y, R: C * 0.42 * SCALE[stack] };
    });
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
    if (res.end) this.queue.push({ kind: 'end', end: res.end, fresh: !!res.next });
    for (const e of res.next || []) this.queue.push(e);
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
      case 'roll': {
        this.activeSeat = e.player;
        const p = this.panelRect(e.player);
        const local = this.isLocal(e.player);
        this.die = { value: e.value, rollT0: now, seat: e.player, dur: this.reduced ? 1 : local ? 760 : 560, from: [p.x + p.w / 2, p.y + p.h / 2], yaw: (now % 1000) / 1000 - 0.5 };
        sfx.dice ? sfx.dice() : sfx.tap();
        this.wait = now + (this.reduced ? 250 : local ? 1000 : 760);
        this.renderControls();
        if (e.value === 6 && this.isLocal(e.player)) haptic(25);
        break;
      }
      case 'move': {
        const path = [];
        if (e.from < 0) path.push(0);
        else for (let p = e.from + 1; p <= e.to; p++) path.push(p);
        this.anim = { player: e.player, token: e.token, path, step: 0, t0: now, captured: e.captured, ms: this.reduced ? 25 : this.isLocal(e.player) ? 160 : 120 };
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
        this.shown = e.fresh ? this.game.players.map(() => [-1, -1, -1, -1]) : this.game.tokens.map((ts) => ts.slice());
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
        const stepMs = a.ms;
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
    else if (this.busy()) status = this.isLocal(this.activeSeat) ? '🎲 Rolling…' : `${esc(this.label(this.activeSeat))} is playing…`;
    else if (s.canRoll()) status = `<b>${this.isLocal(g.turn) && s.mySide === undefined ? `${this.label(g.turn)}'s turn – ` : 'Your turn – '}tap the dice 🎲</b>`;
    else if (s.canMove()) status = `<b>Rolled ${g.roll} – tap a glowing token</b>`;
    else status = `${this.label(g.turn)} is playing…`;
    this.controls.innerHTML = `<div class="col" style="gap:6px;width:100%">
      <div class="small center">${fresh ? `${esc(this.note)}<br>` : ''}${status}</div>
      ${s.resign ? `<button class="btn sm ghost" data-a="resign" ${s.over ? 'disabled' : ''}>🏳️ ${s.resignLabel || 'Leave table'}</button>` : ''}</div>`;
    const b = this.controls.querySelector('[data-a="resign"]');
    if (b) b.onclick = () => this.hooks.onQuit?.();
  }

  // ---------------- drawing
  /** The felt dice tray with the one die in it (or flying into it). */
  drawTray(now) {
    const ctx = this.ctx, g = this.game;
    const t = this.trayRect(), d = this.diceRect();
    const seat = this.die.rollT0 && now - this.die.rollT0 < (this.die.dur || 0) + 400 ? this.die.seat : this.activeSeat;
    const col = COLORS[seat] || 'red';
    const canTap = !g.over && this.sim.canRoll() && this.isLocal(g.turn) && !this.busy();
    ctx.save();
    softShadow(ctx, t.x + t.s / 2, t.y + t.s - 2, t.s * 0.55, 9, 0.5);
    // coloured rim = whose turn it is
    roundedRect(ctx, t.x, t.y, t.s, t.s, 14);
    ctx.fillStyle = DARK[col];
    ctx.fill();
    roundedRect(ctx, t.x + 4, t.y + 4, t.s - 8, t.s - 8, 11);
    const felt = ctx.createRadialGradient(t.x + t.s / 2, t.y + t.s * 0.4, 2, t.x + t.s / 2, t.y + t.s / 2, t.s * 0.6);
    felt.addColorStop(0, '#1f5a3a');
    felt.addColorStop(1, '#0f3322');
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    if (canTap) {
      const k = this.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(now / 220);
      ctx.shadowColor = 'rgba(255,214,94,0.95)';
      ctx.shadowBlur = 10 + k * 14;
      ctx.strokeStyle = `rgba(255,214,94,${0.55 + k * 0.45})`;
      ctx.lineWidth = 3;
      roundedRect(ctx, t.x - 3, t.y - 3, t.s + 6, t.s + 6, 16);
      ctx.stroke();
    }
    ctx.restore();
    const st = this.die;
    const cx = d.x + d.s / 2, cy = d.y + d.s / 2;
    const tt = (now - (st.rollT0 || 0)) / (st.dur || 1);
    if (st.rollT0 && tt < 1 && st.from) {
      const pose = throwPose(tt, st.from[0], st.from[1], cx, cy);
      drawDie3D(ctx, pose.x, pose.y - pose.z * d.s * 0.8, d.s * (1 + pose.z * 0.25), st.value, pose.spin, st.yaw || 0);
    } else {
      drawDie3D(ctx, cx, cy - (canTap && !this.reduced ? Math.abs(Math.sin(now / 300)) * 2 : 0), d.s, st.value, 0, st.yaw || 0);
    }
  }

  drawPanels(now) {
    const ctx = this.ctx, g = this.game;
    g.players.forEach((pl, seat) => {
      if (!pl) return;
      const p = this.panelRect(seat);
      const col = COLORS[seat];
      const active = seat === this.activeSeat && !g.over;
      const place = g.finished.indexOf(seat);
      // a felt name tag lying on the table
      ctx.save();
      softShadow(ctx, p.x + p.w / 2, p.y + p.h - 2, p.w * 0.55, 10, 0.45);
      const grd = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      grd.addColorStop(0, active ? 'rgba(40,30,22,0.92)' : 'rgba(25,18,12,0.78)');
      grd.addColorStop(1, active ? 'rgba(20,14,10,0.92)' : 'rgba(12,8,5,0.78)');
      ctx.fillStyle = grd;
      roundedRect(ctx, p.x, p.y, p.w, p.h, 14);
      ctx.fill();
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.strokeStyle = active ? '#ffd45e' : 'rgba(255,255,255,0.18)';
      ctx.stroke();
      // colour stripe + avatar token
      const ax = p.right ? p.x + p.w - 30 : p.x + 30;
      this.drawToken(ax, p.y + p.h / 2 + 6, 13, col, false, 0);
      const tx = p.right ? ax - 24 : ax + 24;
      ctx.textAlign = p.right ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
      const nm = this.label(seat);
      ctx.fillText(nm, tx, p.y + p.h * 0.36, p.w - 62);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = active ? '#ffd45e' : 'rgba(255,255,255,0.7)';
      const home = g.tokens[seat].filter((x) => x === HOME).length;
      let sub = `home ${home}/4`;
      if (place >= 0) sub = `🏆 ${['1st', '2nd', '3rd', '4th'][place]} place`;
      else if (active) {
        const mine = this.isLocal(seat) && !this.busy();
        sub = mine && this.sim.canRoll() ? '🎲 Tap the dice' : mine && this.sim.canMove() ? `Rolled ${g.roll} · move a token` : this.die.rollT0 && this.die.seat === seat && !this.anim ? 'rolling…' : 'playing…';
      }
      ctx.fillText(sub, tx, p.y + p.h * 0.7, p.w - 62);
      ctx.restore();
    });
    this.drawTray(now);
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const F = this.frame;
    const bx = this.ox - F, by = this.oy - F, bs = this.size + F * 2;
    // board shadow on the table, then the wooden frame
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#3a200e';
    roundedRect(ctx, bx, by, bs, bs, 12);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundedRect(ctx, bx, by, bs, bs, 12);
    ctx.clip();
    ctx.drawImage(woodTexture('frame', 256, 256), bx, by, bs, bs);
    const bev = ctx.createLinearGradient(bx, by, bx + bs, by + bs);
    bev.addColorStop(0, 'rgba(255,255,255,0.25)');
    bev.addColorStop(0.5, 'rgba(255,255,255,0)');
    bev.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = bev;
    ctx.fillRect(bx, by, bs, bs);
    ctx.restore();
    this.drawBoard(now);
    this.drawPanels(now);
    this.drawTokens(now);
    // centre-board banner
    if (this.note && performance.now() - this.noteT < 1600) {
      const t = (performance.now() - this.noteT) / 1600;
      ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
      ctx.fillStyle = 'rgba(20,12,6,0.85)';
      const w = Math.min(this.W - 20, 320);
      // under the table row when there's room, so the board stays clear
      const below = this.oy + this.size + this.frame + 8 + this.panelH + 12;
      const cy = below + 40 <= this.H ? below + 20 : this.oy + this.size / 2;
      roundedRect(ctx, this.W / 2 - w / 2, cy - 20, w, 40, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.note, this.W / 2, cy, w - 16);
      ctx.globalAlpha = 1;
    }
  }

  /** The printed, laminated board – drawn unrotated, then turned to your seat. */
  drawBoard() {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.save();
    ctx.translate(this.ox + this.size / 2, this.oy + this.size / 2);
    ctx.rotate((this.rot * Math.PI) / 2);
    ctx.translate(-this.size / 2, -this.size / 2);
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0, 0, 15 * C, 15 * C);
    // bases
    BASE_ORIGIN.forEach(([r, c], i) => {
      const col = COLORS[i];
      const x = c * C, y = r * C;
      const bg = ctx.createLinearGradient(x, y, x + 6 * C, y + 6 * C);
      bg.addColorStop(0, FILL[col]);
      bg.addColorStop(1, DARK[col]);
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, 6 * C, 6 * C);
      ctx.fillStyle = '#fbf6ea';
      roundedRect(ctx, x + 0.75 * C, y + 0.75 * C, 4.5 * C, 4.5 * C, C * 0.7);
      ctx.fill();
      // four recessed wells
      for (const [sr, sc] of SLOTS) {
        const wx = x + sc * C, wy = y + sr * C;
        const wg = ctx.createRadialGradient(wx, wy - C * 0.12, C * 0.1, wx, wy, C * 0.66);
        wg.addColorStop(0, '#ffffff');
        wg.addColorStop(1, LIGHT[col]);
        ctx.fillStyle = wg;
        ctx.beginPath(); ctx.arc(wx, wy, C * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = FILL[col];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (!g.players[i]) { ctx.fillStyle = 'rgba(251,246,234,0.6)'; ctx.fillRect(x, y, 6 * C, 6 * C); }
    });
    // track squares with printed lines
    TRACK.forEach(([r, c], i) => {
      const startOf = START.indexOf(i);
      ctx.fillStyle = startOf >= 0 ? FILL[COLORS[startOf]] : '#fbf6ea';
      ctx.fillRect(c * C, r * C, C, C);
      if (SAFE.has(i)) {
        ctx.fillStyle = startOf >= 0 ? 'rgba(255,255,255,0.9)' : '#a99a7c';
        star(ctx, (c + 0.5) * C, (r + 0.5) * C, C * 0.32, C * 0.14);
      }
    });
    HOMECOL.forEach((cells, i) => {
      for (const [r, c] of cells) { ctx.fillStyle = FILL[COLORS[i]]; ctx.fillRect(c * C, r * C, C, C); }
    });
    // printed grid: one line per edge, shared by neighbouring squares
    const lw = Math.max(1, Math.round(this.dpr)) / this.dpr;
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      // vertical arms (cols 6..9) and horizontal arms (rows 6..9)
      ctx.moveTo((6 + k) * C, 0); ctx.lineTo((6 + k) * C, 6 * C);
      ctx.moveTo((6 + k) * C, 9 * C); ctx.lineTo((6 + k) * C, 15 * C);
      ctx.moveTo(0, (6 + k) * C); ctx.lineTo(6 * C, (6 + k) * C);
      ctx.moveTo(9 * C, (6 + k) * C); ctx.lineTo(15 * C, (6 + k) * C);
    }
    for (let k = 0; k <= 6; k++) {
      ctx.moveTo(6 * C, k * C); ctx.lineTo(9 * C, k * C);
      ctx.moveTo(6 * C, (9 + k) * C); ctx.lineTo(9 * C, (9 + k) * C);
      ctx.moveTo(k * C, 6 * C); ctx.lineTo(k * C, 9 * C);
      ctx.moveTo((9 + k) * C, 6 * C); ctx.lineTo((9 + k) * C, 9 * C);
    }
    ctx.strokeStyle = 'rgba(60,42,26,0.42)';
    ctx.lineWidth = lw;
    ctx.stroke();
    // firmer outline around each arm and the centre
    ctx.strokeStyle = 'rgba(50,34,20,0.6)';
    ctx.lineWidth = lw * 1.6;
    ctx.strokeRect(6 * C, 0, 3 * C, 6 * C);
    ctx.strokeRect(6 * C, 9 * C, 3 * C, 6 * C);
    ctx.strokeRect(0, 6 * C, 6 * C, 3 * C);
    ctx.strokeRect(9 * C, 6 * C, 6 * C, 3 * C);
    // entry arrows (just before each home column)
    [[7, 0, 0], [0, 7, 1], [7, 14, 2], [14, 7, 3]].forEach(([r, c, i]) => {
      ctx.save();
      ctx.translate((c + 0.5) * C, (r + 0.5) * C);
      ctx.rotate([0, Math.PI / 2, Math.PI, -Math.PI / 2][i]);
      ctx.fillStyle = FILL[COLORS[i]];
      ctx.beginPath(); ctx.moveTo(C * 0.35, 0); ctx.lineTo(-C * 0.15, -C * 0.3); ctx.lineTo(-C * 0.15, C * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    // home: four triangles meeting at a gold centre
    const tri = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0] * C, pts[0][1] * C); for (const q of pts.slice(1)) ctx.lineTo(q[0] * C, q[1] * C); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke(); };
    tri([[6, 6], [7.5, 7.5], [6, 9]], FILL.red);
    tri([[6, 6], [7.5, 7.5], [9, 6]], FILL.green);
    tri([[9, 6], [7.5, 7.5], [9, 9]], FILL.yellow);
    tri([[6, 9], [7.5, 7.5], [9, 9]], FILL.blue);
    ctx.fillStyle = '#e8c35a';
    ctx.beginPath(); ctx.arc(7.5 * C, 7.5 * C, C * 0.35, 0, Math.PI * 2); ctx.fill();
    // laminated gloss
    const gl = ctx.createLinearGradient(0, 0, 15 * C, 15 * C);
    gl.addColorStop(0, 'rgba(255,255,255,0.12)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0)');
    gl.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, 15 * C, 15 * C);
    ctx.restore();
  }

  drawTokens(now) {
    const C = this.cell, g = this.game;
    const legal = this.sim.canMove() && !this.busy() ? g.legal() : [];
    let hop = 0;
    if (this.anim) hop = Math.sin(Math.min(1, (now - this.anim.t0) / this.anim.ms) * Math.PI);
    const items = this.tokenLayout().map((tok) => ({ ...tok, lifting: this.anim && this.anim.player === tok.pl && this.anim.token === tok.t ? hop : 0 }))
      .sort((a, b) => a.lifting - b.lifting || a.y - b.y);
    for (const it of items) {
      const isLegal = it.pl === g.turn && legal.includes(it.t);
      const bounce = isLegal && !this.reduced ? Math.abs(Math.sin(now / 200)) * C * 0.12 : 0;
      this.drawToken(it.x, it.y, it.R, COLORS[it.pl], isLegal, it.lifting * C * 0.55 + bounce);
    }
  }

  /** A plastic Ludo pawn standing on (x, y). lift = height above the board. */
  drawToken(x, y, R, col, glow, lift = 0) {
    const ctx = this.ctx;
    // contact shadow shrinks as the pawn rises
    softShadow(ctx, x + R * 0.15, y + R * 0.35, R * (0.95 - Math.min(0.4, lift / (R * 3))), R * 0.38, 0.5 - Math.min(0.3, lift / (R * 4)));
    const yb = y - lift;
    if (glow) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y + R * 0.3, R * 1.05, R * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const base = FILL[col], dark = DARK[col];
    // base disc
    const bg = ctx.createLinearGradient(x - R, 0, x + R, 0);
    bg.addColorStop(0, dark); bg.addColorStop(0.35, base); bg.addColorStop(1, dark);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(x, yb + R * 0.28, R * 0.92, R * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(x, yb + R * 0.16, R * 0.86, R * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    // cone body
    const cg = ctx.createLinearGradient(x - R * 0.6, 0, x + R * 0.6, 0);
    cg.addColorStop(0, dark); cg.addColorStop(0.3, '#ffffff'); cg.addColorStop(0.42, base); cg.addColorStop(1, dark);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(x - R * 0.62, yb + R * 0.16);
    ctx.quadraticCurveTo(x - R * 0.32, yb - R * 0.35, x - R * 0.2, yb - R * 0.75);
    ctx.lineTo(x + R * 0.2, yb - R * 0.75);
    ctx.quadraticCurveTo(x + R * 0.32, yb - R * 0.35, x + R * 0.62, yb + R * 0.16);
    ctx.closePath();
    ctx.fill();
    // ball head
    const hg = ctx.createRadialGradient(x - R * 0.15, yb - R * 1.12, R * 0.05, x, yb - R * 0.95, R * 0.45);
    hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.3, base); hg.addColorStop(1, dark);
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(x, yb - R * 0.98, R * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function star(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
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

export const HOW = `<div class="tip">🎲 <b>Tap the dice</b> (bottom centre) to roll, then <b>tap a glowing token</b> to move it. If there's only one possible move, it moves by itself.</div>
<div class="tip">6️⃣ You need a <b>6</b> to bring a token out. A 6, a capture or getting a token home gives you <b>another roll</b> – but three 6s in a row lose your turn!</div>
<div class="tip">💥 Land on an opponent to send it back to base – except on ★ safe squares. Reach home with the exact number.</div>
<div class="tip">🏆 <b>League:</b> pick your colour and face 3 bots. Finish 1st or 2nd to move to a tougher table; 3rd or 4th ends your run.</div>`;

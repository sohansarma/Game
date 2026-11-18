// Tide of the Day – board + colour buttons.
import { N, PALETTE, SYMBOLS, COLORS, region } from './tide.js';
import { sfx, haptic } from '../audio.js';

export default class TideView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.wave = null; // { cells: Map(index -> delay), t0 }
    this.destroyed = false;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.onKey = (e) => { const n = Number(e.key); if (n >= 1 && n <= COLORS && !document.querySelector('.modal.open')) this.pick(n - 1); };
    window.addEventListener('keydown', this.onKey);
    this.canvas.onpointerdown = (e) => this.tapBoard(e);
    this.renderControls();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.W = r.width; this.H = r.height;
    this.size = Math.floor(Math.min(this.W - 12, this.H - 12) / N) * N;
    this.cell = this.size / N;
    this.ox = (this.W - this.size) / 2;
    this.oy = (this.H - this.size) / 2;
  }

  /** Tapping a tile picks its colour (as well as the buttons). */
  tapBoard(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left - this.ox, y = e.clientY - r.top - this.oy;
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.pick(this.sim.grid[Math.floor(y / this.cell) * N + Math.floor(x / this.cell)]);
  }

  pick(c) {
    const s = this.sim;
    if (s.over) return;
    const before = new Set(region(s.grid));
    const res = s.pick(c);
    if (!res.ok) { haptic(8); return; }
    // ripple: newly flooded tiles light up in order of distance from the corner
    const cells = new Map();
    for (const i of region(s.grid)) if (!before.has(i)) cells.set(i, (Math.floor(i / N) + (i % N)) * 18);
    this.wave = { cells, t0: performance.now() };
    if (res.gained >= 8) { sfx.match?.(Math.min(5, 2 + Math.floor(res.gained / 8))); haptic(18); }
    else if (res.gained > 0) sfx.swap();
    else sfx.tap();
    this.renderControls();
    this.hooks.onChange?.(s);
    if (s.over) {
      if (s.solved) { sfx.win(); haptic(40); }
      setTimeout(() => this.hooks.onOver?.(s), s.solved ? 1100 : 700);
    }
  }

  renderControls() {
    const s = this.sim;
    const left = s.limit - s.moves.length;
    this.controls.innerHTML = `<div class="col" style="gap:8px;width:100%;align-items:center">
      <div class="tide-picks">${PALETTE.map((col, c) => `<button class="tide-pick ${c === s.grid[0] ? 'cur' : ''}" data-c="${c}" style="--c:${col}" aria-label="Colour ${c + 1}" ${s.over || c === s.grid[0] ? 'disabled' : ''}><span>${SYMBOLS[c]}</span></button>`).join('')}</div>
      <div class="small center ${left <= 2 && !s.over ? 'tide-warn' : 'muted'}">${s.over ? (s.solved ? `🌊 Tide in, ${s.moves.length} moves!` : 'Out of moves') : `${left} move${left === 1 ? '' : 's'} left · par ${s.par} · 💎 ${s.perfect} · ${s.covered}% flooded`}</div>
    </div>`;
    for (const b of this.controls.querySelectorAll('[data-c]')) b.onclick = () => this.pick(Number(b.dataset.c));
  }

  loop(now) {
    if (this.destroyed) return;
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, s = this.sim;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    // board tray
    ctx.fillStyle = 'rgba(0,20,60,0.35)';
    roundRect(ctx, this.ox - 6, this.oy - 6, this.size + 12, this.size + 12, 16);
    ctx.fill();
    const inTide = new Set(region(s.grid));
    const w = this.wave;
    const t = w ? now - w.t0 : 1e9;
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      const x = this.ox + c * C, y = this.oy + r * C;
      let lift = 0;
      if (w && w.cells.has(i) && !this.reduced) {
        const k = (t - w.cells.get(i)) / 260;
        if (k < 0) { // not reached yet: still the old look
          lift = 0;
        } else if (k < 1) lift = Math.sin(k * Math.PI) * C * 0.12;
      }
      const col = PALETTE[s.grid[i]];
      ctx.fillStyle = col;
      roundRect(ctx, x + 1.5, y + 1.5 - lift, C - 3, C - 3, C * 0.22);
      ctx.fill();
      // soft gloss + symbol (colour-blind friendly)
      const g = ctx.createLinearGradient(x, y, x, y + C);
      g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = inTide.has(i) ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.28)';
      ctx.font = `900 ${C * 0.42}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SYMBOLS[s.grid[i]], x + C / 2, y + C / 2 - lift + 1);
    }
    // outline the tide
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const i of inTide) {
      const r = Math.floor(i / N), c = i % N, x = this.ox + c * C, y = this.oy + r * C;
      if (r === 0 || !inTide.has(i - N)) { ctx.moveTo(x, y); ctx.lineTo(x + C, y); }
      if (r === N - 1 || !inTide.has(i + N)) { ctx.moveTo(x, y + C); ctx.lineTo(x + C, y + C); }
      if (c === 0 || !inTide.has(i - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y + C); }
      if (c === N - 1 || !inTide.has(i + 1)) { ctx.moveTo(x + C, y); ctx.lineTo(x + C, y + C); }
    }
    ctx.stroke();
    // a little wave marker in the starting corner
    ctx.font = `${C * 0.55}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillStyle = '#000';
    if (!s.over) ctx.fillText('🌊', this.ox - C * 0.05, this.oy - C * 0.05);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hud(sim) {
  return [
    { label: 'Moves', value: `${sim.moves.length}/${sim.limit}`, big: true },
    { label: 'Par', value: `⛳ ${sim.par} · 💎 ${sim.perfect}` },
    { label: 'Flooded', value: `${sim.covered}%` },
  ];
}

export const HOW = `<div class="tip">🌊 The tide starts in the <b>top-left corner</b>. Pick a colour: the tide turns that colour and swallows every touching tile of it.</div>
<div class="tip">🎯 Flood the <b>whole board</b> within the move limit. <b>💎 Perfect</b> is the best line our solver found; <b>par</b> is one more.</div>
<div class="tip">📅 Everyone gets the <b>same puzzle</b> each day, and only your <b>first try</b> counts. Share your result and keep your tide streak going!</div>`;

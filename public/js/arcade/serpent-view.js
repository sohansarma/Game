// Sea Serpent renderer + input.
import { COLS, ROWS } from './serpent.js';
import { sfx, haptic } from '../audio.js';
import { roundRect } from '../matchview.js';

const STEP = 1000 / 60;

export default class SerpentView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.particles = [];
    this.destroyed = false;
    this.overSent = false;
    controls.innerHTML = `<div class="dpad">
      <button class="btn sm ghost" data-d="l" aria-label="Left">◀</button>
      <button class="btn sm ghost" data-d="u" aria-label="Up">▲</button>
      <button class="btn sm ghost" data-d="d" aria-label="Down">▼</button>
      <button class="btn sm ghost" data-d="r" aria-label="Right">▶</button>
      <button class="btn sm" data-dash aria-label="Dash (costs a segment)">⚡ Dash</button></div>`;
    controls.querySelector('[data-dash]').onpointerdown = (e) => { e.preventDefault(); this.dash(); };
    for (const b of controls.querySelectorAll('[data-d]')) b.onpointerdown = (e) => { e.preventDefault(); this.turn(b.dataset.d); };
    this.resize(); // re-measure whenever the layout changes (controls rendering, rotation), not just on window resize
    if (typeof ResizeObserver !== 'undefined') { this.sizeObs = new ResizeObserver(() => { if (!this.destroyed) this.resize(); }); this.sizeObs.observe(this.canvas); }
    this.bind();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unbind();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.cell = Math.floor(Math.min(rect.width / COLS, rect.height / ROWS));
    this.ox = Math.floor((rect.width - this.cell * COLS) / 2);
    this.oy = Math.floor((rect.height - this.cell * ROWS) / 2);
  }

  ghostKey() {
    return `tidepop-serpent-ghost:${this.sim.seed}`;
  }
  loadGhost() {
    try {
      const g = JSON.parse(localStorage.getItem(this.ghostKey()) || 'null');
      if (!g || !Array.isArray(g.acts)) return null;
      return { sim: new this.sim.constructor(this.sim.seed), acts: g.acts, i: 0 };
    } catch { return null; }
  }
  saveGhost() {
    try {
      const old = JSON.parse(localStorage.getItem(this.ghostKey()) || 'null');
      if (!this.sim.score || (old && old.score >= this.sim.score)) return;
      const acts = this.sim.log.filter((a) => a[0] !== 'q');
      if (acts.length > 20000) return;
      localStorage.setItem(this.ghostKey(), JSON.stringify({ score: this.sim.score, acts }));
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('tidepop-serpent-ghost:'));
      if (keys.length > 8) for (const k of keys.slice(0, keys.length - 8)) if (k !== this.ghostKey()) localStorage.removeItem(k);
    } catch { /* no ghost */ }
  }
  stepGhost() {
    const g = this.ghost;
    if (!g || g.sim.over || !this.sim.started) return;
    while (g.i < g.acts.length && g.acts[g.i][1] <= g.sim.tick) {
      const a = g.acts[g.i++];
      if (a[0] === 's') g.sim.start(); else if (a[0] === 't') g.sim.turn(a[2]); else if (a[0] === 'b') g.sim.dash();
    }
    g.sim.step();
  }

  dash() {
    if (this.sim.dash()) { sfx.special(); haptic(20); this.hooks.onChange?.(this.sim); }
    else { sfx.bad?.(); if (this.sim.body.length <= 4) this.note = { text: 'Grow to 5 to dash', t0: performance.now() }; }
  }

  turn(d) {
    if (this.sim.over) return;
    if (this.sim.turn(d)) { sfx.tap(); haptic(6); }
  }

  bind() {
    const cv = this.canvas;
    let start = null;
    const down = (e) => {
      start = { x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ }
      if (!this.sim.started) this.sim.start();
    };
    const move = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) < 22) return;
      this.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
      start = { x: e.clientX, y: e.clientY };
    };
    const up = () => { start = null; };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      const d = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r' }[e.key];
      if (d) { e.preventDefault(); this.turn(d); }
      else if (e.key === ' ' && !this.sim.started) this.sim.start();
      else if (e.key === ' ' || e.key === 'Shift') { e.preventDefault(); this.dash(); }
    };
    const resize = () => this.resize();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  loop(now) {
    if (this.destroyed) return;
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    let changed = false;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.ghost === undefined) this.ghost = this.loadGhost();
      if (!this.sim.over) this.stepGhost();
      this.sim.step();
      for (const e of this.sim.events) {
        if (e === 'eat') { sfx.match(Math.min(8, 1 + Math.floor(this.sim.eaten / 5))); this.burstAtHead('#ff8a80'); changed = true; }
        if (e === 'gotPearl') { sfx.rainbow(); haptic(25); this.burstAtHead('#ffffff'); changed = true; }
        if (e === 'pearl') sfx.special();
        if (e === 'rock') sfx.place();
        if (e === 'die') { sfx.boom(); haptic(80); changed = true; }
      }
    }
    if (changed) this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      this.saveGhost();
      setTimeout(() => this.hooks.onOver?.(this.sim), 500);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  burstAtHead(color) {
    const [x, y] = this.sim.body[0];
    for (let i = 0; i < (this.reduced ? 3 : 10); i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5;
      this.particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
    }
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, s = this.sim;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.ox, this.oy);
    // sand board
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#1f6f6a' : '#23807a';
        ctx.fillRect(x * C, y * C, C, C);
      }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, COLS * C, ROWS * C);
    // rocks
    for (const [x, y] of s.rocks) {
      ctx.fillStyle = '#6d6f7a';
      roundRect(ctx, x * C + 2, y * C + 2, C - 4, C - 4, C * 0.3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(x * C + C * 0.35, y * C + C * 0.35, C * 0.12, 0, Math.PI * 2); ctx.fill();
    }
    // food: shrimp
    if (s.food) {
      const [x, y] = s.food;
      const bob = this.reduced ? 0 : Math.sin(now / 200) * C * 0.06;
      ctx.save();
      ctx.translate(x * C + C / 2, y * C + C / 2 + bob);
      ctx.strokeStyle = '#ff8a80';
      ctx.lineWidth = C * 0.22;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, C * 0.24, Math.PI * 0.9, Math.PI * 2.3); ctx.stroke();
      ctx.fillStyle = '#1b1b2f';
      ctx.beginPath(); ctx.arc(C * 0.2, -C * 0.12, C * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // golden pearl with timer ring
    if (s.pearl) {
      const { x, y, until } = s.pearl;
      const left = (until - s.tick) / (60 * 6);
      const cx = x * C + C / 2, cy = y * C + C / 2;
      ctx.fillStyle = '#ffe082';
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(cx, cy, C * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = left < 0.3 ? '#ff5252' : '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, C * 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    }
    // ghost: your best run on this course, see-through
    const gs = this.ghost?.sim;
    if (gs && gs.started && !gs.over && s.started) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (const [x, y] of gs.body) { ctx.beginPath(); ctx.arc(x * C + C / 2, y * C + C / 2, C * 0.36, 0, Math.PI * 2); ctx.fill(); }
    }
    // serpent: a smooth tube that glides between cells
    const n = s.body.length;
    const sub = s.over || !s.started || this.reduced ? 1 : Math.min(1, (s.tick - s.lastMove + this.acc / STEP) / Math.max(1, s.moveGap));
    const pts = s.body.map(([x, y], i) => {
      const p = s.prev[i] || s.body[i];
      return [(p[0] + (x - p[0]) * sub) * C + C / 2, (p[1] + (y - p[1]) * sub) * C + C / 2];
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.dashing && !this.reduced) {
      ctx.strokeStyle = 'rgba(255,230,120,0.35)';
      ctx.lineWidth = C * 1.05;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    for (let i = n - 1; i > 0; i--) {
      const t = i / Math.max(1, n - 1);
      ctx.strokeStyle = `hsl(${165 - t * 40}, 80%, ${55 - t * 15}%)`;
      ctx.lineWidth = C * (0.84 - t * 0.3);
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i - 1][0], pts[i - 1][1]); ctx.stroke();
    }
    // shine stripe and scales
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = C * 0.14;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - C * 0.08, y - C * 0.08) : ctx.moveTo(x - C * 0.08, y - C * 0.08))); ctx.stroke();
    ctx.fillStyle = `hsl(165, 80%, 55%)`;
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], C * 0.46, 0, Math.PI * 2); ctx.fill();
    // head eyes (follow the gliding head)
    const hx = (pts[0][0] - C / 2) / C, hy = (pts[0][1] - C / 2) / C;
    const look = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] }[s.dir];
    for (const side of [-1, 1]) {
      const ex = hx * C + C / 2 + look[0] * C * 0.15 + look[1] * side * C * 0.18;
      const ey = hy * C + C / 2 + look[1] * C * 0.15 + look[0] * side * C * 0.18;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, C * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.over ? '#ff5252' : '#1b1b2f';
      ctx.beginPath(); ctx.arc(ex + look[0] * C * 0.04, ey + look[1] * C * 0.04, C * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    // particles
    for (const p of this.particles) {
      p.x += p.vx / 60; p.y += p.vy / 60; p.life -= 1.8 / 60;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * C, p.y * C, C * 0.12, C * 0.12);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.note && performance.now() - this.note.t0 < 1300) {
      ctx.fillStyle = '#ffd23f';
      ctx.font = `800 ${C * 0.5}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(this.note.text, (COLS * C) / 2, C * 1.6);
    }
    if (s.dashing) {
      ctx.fillStyle = '#ffe082';
      ctx.font = `800 ${C * 0.5}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('⚡ DASH +10', (COLS * C) / 2, C * 0.8);
    }
    if (!s.started) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, COLS * C, ROWS * C);
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${C * 0.8}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Swipe to start!', (COLS * C) / 2, (ROWS * C) / 2);
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Length', value: `🐍 ${sim.body.length}` },
    { label: 'Pearls', value: `🟡 ${sim.pearls}` },
  ];
}

export const HOW = `<div class="tip">🐍 <b>Swipe</b>, use the arrow pad or arrow keys to steer the serpent.</div>
<div class="tip">⚡ <b>Dash</b> (button or Space) spends your last segment for 2 seconds of double speed – shrimp caught while dashing are worth <b>+10</b> more.</div>
<div class="tip">🦐 Eat shrimp to grow (<b>+10</b>, more as you get longer). You get faster as you grow!</div>
<div class="tip">🟡 Golden pearls appear for <b>6 seconds</b> only – grab them for <b>+50</b>. A 🪨 rock drops every 5 shrimp.</div>
<div class="tip">💥 Don't hit the walls, rocks or your own tail.</div>`;

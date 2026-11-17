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
      <button class="btn sm ghost" data-d="r" aria-label="Right">▶</button></div>`;
    for (const b of controls.querySelectorAll('[data-d]')) b.onpointerdown = (e) => { e.preventDefault(); this.turn(b.dataset.d); };
    this.resize();
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
      setTimeout(() => this.hooks.onOver?.(this.sim), 900);
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
    // serpent
    const n = s.body.length;
    for (let i = n - 1; i >= 0; i--) {
      const [x, y] = s.body[i];
      const t = i / Math.max(1, n - 1);
      const r = C * (0.46 - t * 0.14);
      ctx.fillStyle = `hsl(${165 - t * 40}, 80%, ${55 - t * 15}%)`;
      ctx.beginPath(); ctx.arc(x * C + C / 2, y * C + C / 2, r, 0, Math.PI * 2); ctx.fill();
      if (i % 2 === 0 && i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(x * C + C / 2, y * C + C / 2, r * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // head eyes
    const [hx, hy] = s.body[0];
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
<div class="tip">🦐 Eat shrimp to grow (<b>+10</b>, more as you get longer). You get faster as you grow!</div>
<div class="tip">🟡 Golden pearls appear for <b>6 seconds</b> only – grab them for <b>+50</b>. A 🪨 rock drops every 5 shrimp.</div>
<div class="tip">💥 Don't hit the walls, rocks or your own tail.</div>`;

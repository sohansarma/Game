// Coral Breaker renderer + input.
import { WW, WH, COLS, BRICK_H, BRICK_TOP, PADDLE_Y, BALL_R } from './breaker.js';
import { sfx, haptic } from '../audio.js';
import { roundRect } from '../matchview.js';

const STEP = 1000 / 60;

export default class BreakerView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.particles = [];
    this.keys = { l: false, r: false };
    this.destroyed = false;
    this.overSent = false;
    this.pointerX = null;
    controls.innerHTML = '<div class="small muted center">Drag to move · tap to launch · or ← → and Space</div>';
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
    this.k = Math.min(rect.width / WW, rect.height / WH);
    this.ox = (rect.width - WW * this.k) / 2;
    this.oy = (rect.height - WH * this.k) / 2;
  }

  worldX(clientX) {
    const r = this.canvas.getBoundingClientRect();
    return (clientX - r.left - this.ox) / this.k;
  }

  bind() {
    const cv = this.canvas;
    const down = (e) => {
      e.preventDefault();
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ }
      this.pointerX = this.worldX(e.clientX);
      if (this.sim.attached) { if (this.sim.launch()) sfx.swap(); }
    };
    const move = (e) => { if (e.buttons || e.pointerType !== 'mouse' || this.pointerX !== null) this.pointerX = this.worldX(e.clientX); };
    const up = () => {};
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      if (e.key === 'ArrowLeft') this.keys.l = e.type === 'keydown';
      if (e.key === 'ArrowRight') this.keys.r = e.type === 'keydown';
      if (e.key === ' ' && e.type === 'keydown') { e.preventDefault(); if (this.sim.launch()) sfx.swap(); }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); this.pointerX = null; }
    };
    const resize = () => this.resize();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
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
      // one input per tick, only when it changes
      if (this.pointerX !== null) this.sim.input(this.pointerX);
      else if (this.keys.l || this.keys.r) this.sim.input(this.sim.px + (this.keys.r ? 6 : -6));
      const lvl = this.sim.level;
      this.sim.step();
      for (const e of this.sim.events) {
        if (e === 'hit') { sfx.tap(); }
        if (e === 'break') { sfx.match(1 + (this.sim.level % 6)); changed = true; this.burst(this.sim.bx, this.sim.by); }
        if (e === 'paddle') sfx.place();
        if (e === 'lost') { sfx.lose(); haptic(60); changed = true; }
        if (e === 'clear') { sfx.win(); haptic(40); changed = true; }
        if (e.startsWith('power:')) { sfx.coin(); haptic(15); changed = true; }
      }
      if (this.sim.level !== lvl) changed = true;
    }
    if (changed) this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      setTimeout(() => this.hooks.onOver?.(this.sim), 900);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  burst(x, y) {
    for (let i = 0; i < (this.reduced ? 3 : 9); i++) {
      const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random();
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: `hsl(${10 + Math.random() * 30},90%,65%)` });
    }
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim, k = this.k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.ox, this.oy);
    ctx.scale(k, k);
    const g = ctx.createLinearGradient(0, 0, 0, WH);
    g.addColorStop(0, '#1a3a6b');
    g.addColorStop(1, '#0b1a33');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WW, WH);
    // bricks
    const bw = WW / COLS;
    for (const b of s.bricks) {
      const x = b.c * bw, y = BRICK_TOP + b.r * BRICK_H;
      const hue = [0, 12, 330, 280][Math.min(3, b.max)] + b.r * 3;
      ctx.fillStyle = `hsl(${hue}, 80%, ${45 + b.hp * 8}%)`;
      roundRect(ctx, x + 0.4, y + 0.4, bw - 0.8, BRICK_H - 0.8, 1.2);
      ctx.fill();
      if (b.hp < b.max) { ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x + 4, y + 4.5); ctx.stroke(); }
      if (b.drop) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '700 3px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', x + bw / 2, y + BRICK_H / 2); }
    }
    // drops
    for (const p of s.drops) {
      const col = p.kind === 'W' ? '#4dd6ff' : p.kind === '+' ? '#ff6fb5' : '#ffffff';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b1a33';
      ctx.font = '900 2.6px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'P' ? '●' : p.kind, p.x, p.y + 0.1);
    }
    // paddle (a clam shell)
    const pw = s.paddleW;
    ctx.fillStyle = s.tick < s.wideUntil ? '#4dd6ff' : '#ffb627';
    roundRect(ctx, s.px - pw / 2, PADDLE_Y, pw, 3.2, 1.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(s.px - pw / 2 + 1.5, PADDLE_Y + 0.5, pw - 3, 0.8);
    // ball (pearl)
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#bfe9ff';
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(s.bx, s.by, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // particles
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life -= 0.03;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 0.9, 0.9);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    // lives
    ctx.font = '4px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('⚪'.repeat(s.lives), 2, 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = '800 4px ui-rounded, system-ui';
    ctx.fillText(`Level ${s.level}`, WW - 2, 3);
    if (s.attached && !s.over) {
      ctx.textAlign = 'center';
      ctx.font = '800 5px ui-rounded, system-ui';
      ctx.fillText('Tap to launch!', WW / 2, 110);
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Level', value: sim.level },
    { label: 'Lives', value: `⚪ ${sim.lives}`, warn: sim.lives <= 1 },
  ];
}

export const HOW = `<div class="tip">🧱 <b>Drag</b> left and right to move the clam paddle (or use ← →). <b>Tap</b> to launch the pearl.</div>
<div class="tip">🎯 Where the pearl hits the paddle sets its angle. Brighter coral needs more hits.</div>
<div class="tip">★ Some bricks drop power-ups: <b>W</b> wide paddle, <b>+</b> extra life, <b>●</b> bonus pearl (+50).</div>
<div class="tip">⚡ Clear the wall for a big bonus – the next one is faster. You have 3 pearls.</div>`;

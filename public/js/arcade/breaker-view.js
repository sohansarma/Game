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
    this.trail = [];
    this.shake = 0;
    this.keys = { l: false, r: false };
    this.destroyed = false;
    this.overSent = false;
    this.pointerX = null;
    controls.innerHTML = '<div class="small muted center">Drag to move · tap to launch · or ← → and Space</div>';
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
      // serve: hold to aim (the dotted line follows your finger), let go to fire
      if (this.sim.attached) this.aiming = { y: e.clientY };
    };
    const move = (e) => {
      if (this.aiming) { this.aimX = this.worldX(e.clientX); return; }
      if (e.buttons || e.pointerType !== 'mouse' || this.pointerX !== null) this.pointerX = this.worldX(e.clientX);
    };
    const up = (e) => {
      if (!this.aiming) return;
      const ax = this.aimX ?? this.worldX(e.clientX);
      this.aiming = null; this.aimX = null;
      const aim = Math.round(Math.max(-80, Math.min(80, ((ax - this.sim.bx) / 40) * 100)));
      if (this.sim.attached && this.sim.launch(this.sim.stickOff ? undefined : aim)) sfx.swap();
    };
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
        // each break in a chain rings a little higher
        if (e === 'break') { sfx.match(Math.min(10, this.sim.chain)); changed = true; this.burst(this.sim.bx, this.sim.by); }
        if (e === 'paddle') sfx.place();
        if (e === 'stick') { sfx.tap(); }
        if (e === 'creep') { sfx.bad(); haptic(20); if (!this.reduced) this.shake = 0.6; this.note('The coral creeps closer!'); }
        if (e === 'lost') { sfx.lose(); haptic(60); changed = true; if (!this.reduced) this.shake = 1; }
        if (e === 'crush') { sfx.boom(); haptic(80); changed = true; if (!this.reduced) this.shake = 1; this.note('The coral crushed your clam! −1 pearl'); }
        if (e === 'clear') { sfx.win(); haptic(40); changed = true; }
        if (e.startsWith('power:')) {
          sfx.coin(); haptic(15); changed = true;
          const k = e.slice(6);
          this.note({ W: 'Wide clam!', '+': 'Extra pearl life!', P: '+50 pearl', M: 'Multiball!', S: 'Sticky clam: catch & aim' }[k] || '');
        }
      }
      if (this.sim.level !== lvl) changed = true;
    }
    if (changed) this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      setTimeout(() => this.hooks.onOver?.(this.sim), 500);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  note(text) {
    if (text) this.banner = { text, t0: performance.now() };
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
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 10 * this.shake, (Math.random() - 0.5) * 10 * this.shake);
      this.shake = Math.max(0, this.shake - 0.05);
    }
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
      const col = { W: '#4dd6ff', '+': '#ff6fb5', M: '#b388ff', S: '#7cffb2' }[p.kind] || '#ffffff';
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
    ctx.fillStyle = s.tick < s.stickyUntil ? '#7cffb2' : s.tick < s.wideUntil ? '#4dd6ff' : '#ffb627';
    roundRect(ctx, s.px - pw / 2, PADDLE_Y, pw, 3.2, 1.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(s.px - pw / 2 + 1.5, PADDLE_Y + 0.5, pw - 3, 0.8);
    // aim line while the pearl waits on the paddle
    if (s.attached && !s.over) {
      const off = s.stickOff ? Math.max(-1, Math.min(1, s.stickOff / (pw / 2))) * 0.8 : this.aiming && this.aimX !== null && this.aimX !== undefined ? Math.max(-0.8, Math.min(0.8, (this.aimX - s.bx) / 40)) : 0.35;
      let x = s.bx, y = s.by, vx = off, vy = -Math.sqrt(1 - off * off);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 26; i++) {
        x += vx * 3.2; y += vy * 3.2;
        if (x < BALL_R || x > WW - BALL_R) { vx = -vx; x = Math.max(BALL_R, Math.min(WW - BALL_R, x)); }
        if (y < BRICK_TOP + 2) break;
        ctx.globalAlpha = 0.6 * (1 - i / 26);
        ctx.beginPath(); ctx.arc(x, y, 0.55, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // trail behind the pearls
    if (!this.reduced && !s.attached) {
      this.trail.push({ x: s.bx, y: s.by });
      for (const e of s.extra) this.trail.push({ x: e.bx, y: e.by });
    }
    this.trail = s.attached ? [] : this.trail.slice(-24);
    this.trail.forEach((t, i) => {
      ctx.globalAlpha = (i / this.trail.length) * 0.35;
      ctx.fillStyle = '#bfe9ff';
      ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (0.4 + 0.6 * i / this.trail.length), 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    // pearls
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#bfe9ff';
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(s.bx, s.by, BALL_R, 0, Math.PI * 2); ctx.fill();
    for (const e of s.extra) { ctx.beginPath(); ctx.arc(e.bx, e.by, BALL_R, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
    if (s.chain >= 3) {
      ctx.fillStyle = '#ffd23f';
      ctx.font = '800 3.6px ui-rounded, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Chain ×${s.chain}`, s.bx, s.by - 5);
    }
    if (this.banner) {
      const bt = (now - this.banner.t0) / 1400;
      if (bt > 1) this.banner = null;
      else {
        ctx.globalAlpha = bt > 0.75 ? (1 - bt) / 0.25 : 1;
        ctx.fillStyle = '#fff';
        ctx.font = '800 5px ui-rounded, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.banner.text, WW / 2, 100);
        ctx.globalAlpha = 1;
      }
    }
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
      ctx.fillText(s.stickOff ? 'Tap to fire!' : 'Hold & drag to aim, let go to launch!', WW / 2, 110);
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
<div class="tip">★ Some bricks drop power-ups: <b>W</b> wide paddle, <b>+</b> extra life, <b>M</b> multiball, <b>S</b> sticky clam (catch the pearl, then aim and fire), <b>●</b> bonus pearl (+50).</div>
<div class="tip">🔗 Break several bricks before the pearl comes back for a <b>chain</b> bonus – listen for the notes climbing.</div>
<div class="tip">⚡ Clear the wall for a big bonus – but don't dawdle: the coral creeps down every 30 seconds, and if it reaches your clam you lose a pearl. <b>Hold and drag</b> before a serve to aim it. You have 3 pearls.</div>`;

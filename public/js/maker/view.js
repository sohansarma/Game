// Renderer + input for player-made games (all Maker templates).
import { WW, WH, PALETTES } from './engine.js';
import { sfx, haptic } from '../audio.js';

const STEP = 1000 / 60;
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';

export default class MakerView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.spec = sim.spec;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.popups = [];
    this.pointer = null;
    this.destroyed = false;
    this.overSent = false;
    if (controls) controls.innerHTML = `<div class="small muted center">${{ catch: 'Drag left & right to catch', flap: 'Tap to fly up', tap: 'Tap the goodies, never the hazards', arena: 'Drag to steer your hero' }[this.spec.template]}</div>`;
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

  world(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.k, (e.clientY - r.top - this.oy) / this.k];
  }

  bind() {
    const cv = this.canvas;
    const t = this.spec.template;
    const down = (e) => {
      e.preventDefault();
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      const [x, y] = this.world(e);
      if (t === 'flap') { if (this.sim.flap()) sfx.swap(); }
      else if (t === 'tap') this.handleTap(x, y);
      else this.pointer = [x, y];
    };
    const move = (e) => { if (this.pointer || (e.pointerType === 'mouse' && t !== 'tap' && t !== 'flap')) this.pointer = this.world(e); };
    const up = () => { if (t === 'arena') return; };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      if (t === 'flap' && (e.key === ' ' || e.key === 'ArrowUp')) { e.preventDefault(); if (this.sim.flap()) sfx.swap(); }
      if (t === 'catch' || t === 'arena') {
        const d = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
        if (d) { e.preventDefault(); this.pointer = [this.sim.hx + d[0], (t === 'arena' ? this.sim.hy : 135) + d[1]]; }
      }
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

  handleTap(x, y) {
    this.sim.tap(x, y);
    this.feedback(this.sim.events);
    this.hooks.onChange?.(this.sim);
  }

  feedback(events) {
    for (const e of events) {
      if (e.kind === 'good') { sfx.match(Math.min(8, 1 + Math.floor(e.pts / 10))); this.popups.push({ x: e.x, y: e.y, text: `+${e.pts}`, color: '#ffd23f', t0: performance.now() }); }
      if (e.kind === 'bad') { sfx.lose(); haptic(60); this.popups.push({ x: e.x, y: e.y, text: '💥', color: '#ff5252', t0: performance.now() }); }
      if (e.kind === 'pass') sfx.coin();
      if (e.kind === 'miss') sfx.bad();
    }
  }

  loop(now) {
    if (this.destroyed) return;
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    let changed = false;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.pointer && (this.spec.template === 'catch' || this.spec.template === 'arena')) this.sim.input(this.pointer[0], this.spec.template === 'catch' ? 135 : this.pointer[1]);
      const before = this.sim.score + this.sim.lives * 1e6;
      this.sim.step();
      if (this.sim.events.length) this.feedback(this.sim.events);
      if (this.sim.score + this.sim.lives * 1e6 !== before) changed = true;
      if (this.spec.template === 'tap' && this.sim.tick % 60 === 0) changed = true;
    }
    if (changed) this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      setTimeout(() => this.hooks.onOver?.(this.sim), 800);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  emoji(e, x, y, size) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e, x, y);
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim, k = this.k;
    const [c1, c2] = PALETTES[this.spec.palette] || PALETTES[0];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.rect(0, 0, WW, WH);
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, WH);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WW, WH);
    const R = s.itemR();
    for (const o of s.objs) {
      if (o.kind === 'wall') {
        const top = o.gy - o.gap / 2, bottom = o.gy + o.gap / 2;
        for (let y = 4; y < top - 2; y += 8) this.emoji(o.e, o.x, y, 9);
        for (let y = bottom + 4; y < WH; y += 8) this.emoji(o.e, o.x, y, 9);
        continue;
      }
      let size = R * 2.2;
      if (s.spec.template === 'tap') {
        const age = s.tick - o.born, life = o.until - o.born;
        size *= Math.min(1, age / 6) * Math.min(1, (life - age) / 6 + 0.2);
      }
      if (o.good && !this.reduced) size *= 1 + 0.06 * Math.sin(now / 160 + o.id);
      this.emoji(o.e, o.x, o.y, Math.max(1, size));
    }
    if (s.spec.template !== 'tap') {
      const blink = s.invuln > 0 && Math.floor(now / 90) % 2 === 0;
      if (!blink) {
        const hx = s.spec.template === 'flap' ? 30 : s.hx;
        this.emoji(s.spec.hero, hx, s.hy, 12);
      }
    }
    this.popups = this.popups.filter((p) => now - p.t0 < 700);
    for (const p of this.popups) {
      const t = (now - p.t0) / 700;
      ctx.globalAlpha = 1 - t;
      ctx.font = '900 6px ui-rounded, system-ui, sans-serif';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.text, p.x, p.y - 6 - t * 8);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - 6 - t * 8);
    }
    ctx.globalAlpha = 1;
    if (!s.started) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, WW, WH);
      ctx.fillStyle = '#fff';
      ctx.font = '800 7px ui-rounded, system-ui, sans-serif';
      ctx.fillText('Tap to start!', WW / 2, WH / 2);
    }
    ctx.restore();
  }
}

export function hud(sim) {
  const out = [{ label: 'Score', value: sim.score.toLocaleString('en-US'), big: true }, { label: 'Lives', value: '❤️'.repeat(Math.max(0, sim.lives)) || '–', warn: sim.lives <= 1 }];
  if (sim.spec.template === 'tap') out.push({ label: 'Time', value: `⏱️ ${Math.max(0, Math.ceil(sim.timeLeft / 60))}s`, warn: sim.timeLeft < 600 });
  else out.push({ label: 'Level', value: sim.level });
  return out;
}

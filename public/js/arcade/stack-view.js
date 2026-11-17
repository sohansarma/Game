// Reef Tower renderer + input.
import { WORLD_W } from './stack.js';
import { sfx, haptic } from '../audio.js';

const STEP = 1000 / 60;
const SLAB_H = 9; // world units

export default class StackView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.camY = 0;
    this.falling = [];
    this.flash = 0;
    this.destroyed = false;
    this.overSent = false;
    controls.innerHTML = '<div class="small muted center">Tap (or press Space) to drop the slab</div>';
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
    this.k = rect.width / (WORLD_W + 20);
    this.W = rect.width;
    this.H = rect.height;
  }

  bind() {
    const drop = (e) => {
      if (e?.type === 'keydown') {
        if (document.querySelector('.modal.open') || e.key !== ' ') return;
        e.preventDefault();
      }
      if (this.sim.over) return;
      const res = this.sim.drop();
      if (res.started) { sfx.tap(); return; }
      if (res.miss) {
        sfx.boom(); haptic(80);
        this.falling.push({ ...this.sim.cut, vy: 0, rot: 0, color: this.color(this.sim.tower.length) });
      } else if (res.perfect) {
        sfx.match(Math.min(10, this.sim.streak + 1));
        if (this.sim.streak % 3 === 0) sfx.special();
        haptic(15);
        this.flash = 1;
      } else {
        sfx.place();
        haptic(8);
        if (this.sim.cut) this.falling.push({ ...this.sim.cut, vy: 0, rot: 0, color: this.color(this.sim.tower.length - 1) });
      }
      this.hooks.onChange?.(this.sim);
    };
    const down = (e) => { e.preventDefault(); drop(e); };
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', drop);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', drop);
      window.removeEventListener('resize', resize);
    };
  }

  color(i) {
    return `hsl(${(i * 23) % 360}, 75%, 62%)`;
  }

  loop(now) {
    if (this.destroyed) return;
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= STEP) { this.acc -= STEP; this.sim.step(); }
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      setTimeout(() => this.hooks.onOver?.(this.sim), 1100);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  // world y (floor index * SLAB_H, up is positive) -> screen
  sy(wy) {
    return this.H * 0.82 - (wy - this.camY) * this.k;
  }
  sx(wx) {
    return (wx + 10) * this.k;
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim, k = this.k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // background shifts from sea -> surface -> sky -> space with height
    const h = s.tower.length;
    const t = Math.min(1, h / 60);
    const top = `hsl(${200 + t * 60}, ${70 - t * 40}%, ${55 - t * 45}%)`;
    const bottom = `hsl(${205 + t * 40}, 70%, ${35 - t * 25}%)`;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    if (h > 40) { // stars
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, (h - 40) / 30)})`;
      for (let i = 0; i < 30; i++) ctx.fillRect((i * 97) % this.W, (i * 53) % (this.H * 0.7), 2, 2);
    }
    const target = Math.max(0, (h - 6) * SLAB_H);
    this.camY += (target - this.camY) * (this.reduced ? 1 : 0.08);
    // tower
    const first = Math.max(0, Math.floor(this.camY / SLAB_H) - 2);
    for (let i = first; i < h; i++) {
      const b = s.tower[i];
      this.slab(b.x, i * SLAB_H, b.w, i === 0 ? '#c9a66b' : this.color(i), i === h - 1 && this.flash > 0);
    }
    // moving slab
    if (!s.over) this.slab(s.cur.x, h * SLAB_H, s.cur.w, this.color(h), false, true);
    // falling cut pieces
    for (const f of this.falling) {
      f.vy -= 0.35; f.y = (f.y * SLAB_H + f.vy) / SLAB_H; f.rot += 0.03;
      ctx.save();
      ctx.translate(this.sx(f.x + f.w / 2), this.sy(f.y * SLAB_H + SLAB_H / 2));
      ctx.rotate(f.rot);
      ctx.fillStyle = f.color;
      ctx.fillRect((-f.w / 2) * k, (-SLAB_H / 2) * k, f.w * k, SLAB_H * k);
      ctx.restore();
    }
    this.falling = this.falling.filter((f) => this.sy(f.y * SLAB_H) < this.H + 100);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.05);
    // floor counter
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(this.W * 0.14)}px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(String(s.floors), this.W / 2, this.H * 0.14);
    if (s.streak >= 2 && !s.over) {
      ctx.font = `800 ${Math.round(this.W * 0.05)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`Perfect ×${s.streak}!`, this.W / 2, this.H * 0.24);
    }
    if (!s.started) {
      ctx.font = `800 ${Math.round(this.W * 0.06)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText('Tap to start stacking!', this.W / 2, this.H * 0.4);
    }
  }

  slab(x, wy, w, color, glow, moving) {
    const ctx = this.ctx, k = this.k;
    const X = this.sx(x), Y = this.sy(wy + SLAB_H), W = w * k, H = SLAB_H * k;
    if (glow) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 18; }
    ctx.fillStyle = color;
    ctx.fillRect(X, Y, W, H);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(X, Y, W, H * 0.22);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(X, Y + H * 0.78, W, H * 0.22);
    if (moving) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Floors', value: `🗼 ${sim.floors}` },
    { label: 'Perfects', value: `✨ ${sim.perfects}` },
  ];
}

export const HOW = `<div class="tip">🗼 A slab slides back and forth. <b>Tap</b> to drop it onto the tower.</div>
<div class="tip">✂️ Anything hanging over the edge is sliced off, so the tower gets narrower. Miss completely and it's over!</div>
<div class="tip">✨ A <b>perfect</b> drop keeps the full width and builds a streak bonus – every 3rd perfect in a row makes the slab wider again.</div>
<div class="tip">🚀 Climb from the sea floor past the surface into the stars. It gets faster as you go!</div>`;

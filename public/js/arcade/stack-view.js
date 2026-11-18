// Reef Tower renderer + input.
import { WORLD_W, zoneAt } from './stack.js';
import { sfx, haptic } from '../audio.js';
import { load } from '../storage.js';

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
    this.ripples = [];
    this.bounce = 0;
    this.shake = 0;
    this.popup = null;
    this.bestFloors = load().arcade?.stack?.bestFloors || 0;
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
      if (res.zone) this.popup = { text: `${res.zone.icon} ${res.zone.name}: ${res.zone.tip}`, t0: performance.now(), color: '#9ef0ff' };
      if (res.miss) {
        sfx.boom(); haptic(80);
        if (!this.reduced) this.shake = 1;
        this.falling.push({ ...this.sim.cut, vy: 0, rot: 0, color: this.color(this.sim.tower.length) });
      } else if (res.perfect) {
        sfx.match(Math.min(10, this.sim.streak + 1));
        if (this.sim.streak % 3 === 0) sfx.special();
        haptic(15);
        this.flash = 1;
        const top = this.sim.tower[this.sim.tower.length - 1];
        this.ripples.push({ x: top.x + top.w / 2, w: top.w, i: this.sim.tower.length - 1, t0: performance.now() });
        if (!this.reduced) this.bounce = 1;
      } else if (res.near) {
        sfx.place();
        haptic(10);
        this.popup = { text: 'So close! Snapped on', t0: performance.now(), color: '#cfe8ff' };
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
      setTimeout(() => this.hooks.onOver?.(this.sim), 450);
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
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 12 * this.shake, (Math.random() - 0.5) * 12 * this.shake);
      this.shake = Math.max(0, this.shake - 0.04);
    }
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
    // a little camera bounce on perfect drops
    const bob = this.bounce > 0 ? Math.sin(this.bounce * Math.PI) * 2.2 : 0;
    this.bounce = Math.max(0, this.bounce - 0.06);
    this.camY -= bob * 0.15;
    // your best height, as a dashed line to beat
    if (this.bestFloors > 0) {
      const by = this.sy((this.bestFloors + 1) * SLAB_H);
      if (by > -10 && by < this.H) {
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = s.floors >= this.bestFloors ? 'rgba(124,255,178,0.8)' : 'rgba(255,212,94,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(this.W, by); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '800 12px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(s.floors >= this.bestFloors ? '🏆 New best!' : `Best: ${this.bestFloors}`, 8, by - 3);
      }
    }
    // tower
    const first = Math.max(0, Math.floor(this.camY / SLAB_H) - 2);
    for (let i = first; i < h; i++) {
      const b = s.tower[i];
      this.slab(b.x, i * SLAB_H, b.w, i === 0 ? '#c9a66b' : this.color(i), i === h - 1 && this.flash > 0);
    }
    // perfect ripples spread out from the slab
    this.ripples = this.ripples.filter((r) => now - r.t0 < 600);
    for (const r of this.ripples) {
      const t = (now - r.t0) / 600;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - t)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(this.sx(r.x), this.sy(r.i * SLAB_H + SLAB_H / 2), (r.w / 2 + t * 30) * k, (SLAB_H / 2 + t * 8) * k, 0, 0, Math.PI * 2);
      ctx.stroke();
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
    if (s.started && !s.over) {
      const z = zoneAt(s.floors);
      ctx.font = `700 ${Math.round(this.W * 0.035)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`${z.icon} ${z.name}`, this.W / 2, this.H * 0.06);
    }
    if (this.popup) {
      const pt = (now - this.popup.t0) / 1500;
      if (pt > 1) this.popup = null;
      else {
        ctx.globalAlpha = pt > 0.7 ? (1 - pt) / 0.3 : 1;
        ctx.font = `800 ${Math.round(this.W * 0.045)}px ui-rounded, system-ui, sans-serif`;
        ctx.fillStyle = this.popup.color;
        ctx.fillText(this.popup.text, this.W / 2, this.H * 0.31);
        ctx.globalAlpha = 1;
      }
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
<div class="tip">🎯 Nearly perfect? It <b>snaps</b> on with no slice – but only true perfects build the streak.</div>
<div class="tip">🚀 Climb through zones: 🌊 <b>currents</b> (floor 15) make the slab surge, 🌬️ <b>wind</b> (30) pushes it one way, then ✨ the stars. A dashed line marks your best.</div>`;

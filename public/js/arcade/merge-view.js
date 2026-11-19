// Shell Merge renderer + input with slide / pop animations.
import { N, tileEmoji } from './merge.js';
import { sfx, haptic } from '../audio.js';
import { roundRect } from '../matchview.js';

const HUES = [200, 180, 160, 140, 45, 30, 15, 0, 330, 300, 270, 250, 220, 190, 170, 150];

export default class MergeView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.popups = [];
    this.particles = [];
    this.rebuild();
    this.destroyed = false;
    this.controls = controls;
    this.renderControls();
    this.resize(); // re-measure whenever the layout changes (controls rendering, rotation), not just on window resize
    if (typeof ResizeObserver !== 'undefined') { this.sizeObs = new ResizeObserver(() => { if (!this.destroyed) this.resize(); }); this.sizeObs.observe(this.canvas); }
    this.bind();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  rebuild() {
    this.tiles = new Map(); // id -> {v, x, y, tx, ty, scale, pop}
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = this.sim.grid[r][c];
      if (t) this.tiles.set(t.id, { v: t.v, x: c, y: r, tx: c, ty: r, scale: 1, pop: 0 });
    }
  }

  renderControls() {
    const s = this.sim;
    this.controls.innerHTML = `<div class="row center" style="gap:10px;align-items:center;justify-content:center">
      <span class="small muted">Next: <b style="font-size:1.3em">${tileEmoji(s.nextV)}</b></span>
      <button class="btn sm ghost" data-undo ${s.undos > 0 && s.snap && !s.over ? '' : 'disabled'}>↶ Undo (${s.undos})</button>
      <span class="small muted">Swipe or arrow keys</span></div>`;
    this.controls.querySelector('[data-undo]').onclick = () => {
      if (this.sim.undo()) { sfx.swap(); this.rebuild(); this.renderControls(); this.hooks.onChange?.(this.sim); }
    };
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
    const size = Math.min(rect.width, rect.height) * 0.96;
    this.cell = size / N;
    this.ox = (rect.width - size) / 2;
    this.oy = (rect.height - size) / 2;
    this.size = size;
  }

  bind() {
    const cv = this.canvas;
    let start = null;
    const down = (e) => { start = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ } };
    const up = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      if (Math.hypot(dx, dy) < 24) return;
      this.slide(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u'));
    };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      const d = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r' }[e.key];
      if (d) { e.preventDefault(); this.slide(d); }
    };
    const resize = () => this.resize();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  slide(dir) {
    if (this.sim.over) return;
    const res = this.sim.move(dir);
    if (!res.ok) { sfx.bad(); return; }
    for (const m of res.moves) {
      const t = this.tiles.get(m.id);
      if (!t) continue;
      t.tx = m.c; t.ty = m.r;
      if (m.gone) t.dying = true;
    }
    let biggest = 0;
    for (const m of res.merges) {
      this.tiles.set(m.id, { v: m.v, x: m.c, y: m.r, tx: m.c, ty: m.r, scale: 1, pop: 1, born: performance.now() + 90 });
      this.popups.push({ x: m.c + 0.5, y: m.r + 0.3, text: `+${m.v}`, t0: performance.now() + 90, color: '#fff' });
      if (!this.reduced) for (let i = 0; i < Math.min(14, 3 + Math.log2(m.v)); i++) {
        const a = Math.random() * Math.PI * 2, v = 0.02 + Math.random() * 0.04;
        this.particles.push({ x: m.c + 0.5, y: m.r + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: HUES[Math.min(HUES.length - 1, Math.log2(m.v) - 1)], t0: performance.now() + 90 });
      }
      for (const old of m.from) { const t = this.tiles.get(old); if (t) t.dying = true; }
      biggest = Math.max(biggest, m.v);
    }
    if (res.spawned) {
      const s = res.spawned;
      this.tiles.set(s.id, { v: s.v, x: s.c, y: s.r, tx: s.c, ty: s.r, scale: 0, pop: 0, born: performance.now() + 120 });
    }
    for (const p of res.powers || []) {
      const t = this.tiles.get(p.id);
      if (t) t.dying = true, (t.tx = p.from[1]), (t.ty = p.from[0]);
      this.popups.push({ x: p.c + 0.5, y: p.r + 0.5, text: p.kind === 'ink' ? '🐙 Ink!' : '🦈 Chomp!', t0: performance.now() + 150, color: p.kind === 'ink' ? '#b388ff' : '#7fd4ff', big: true });
      sfx.special();
    }
    if (res.bonus) this.popups.push({ x: N / 2, y: N / 2, text: `Combo ×${res.merges.length}! +${res.bonus}`, t0: performance.now() + 120, color: '#ffd23f', big: true });
    if (res.earned) { this.popups.push({ x: N / 2, y: N / 2 + 0.6, text: `New ${tileEmoji(this.sim.best)}! +1 undo`, t0: performance.now() + 200, color: '#7cffb2', big: true }); sfx.win(); }
    this.renderControls();
    if (biggest) {
      sfx.match(Math.min(10, Math.log2(biggest) - 1 + (res.merges.length > 1 ? 1 : 0)));
      if (biggest >= 128) { sfx.special(); haptic(25); }
      if (biggest === 2048) sfx.win();
    } else sfx.swap();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over) setTimeout(() => this.hooks.onOver?.(this.sim), 600);
  }

  loop(now) {
    if (this.destroyed) return;
    const k = this.reduced ? 1 : 0.35;
    for (const [id, t] of this.tiles) {
      t.x += (t.tx - t.x) * k;
      t.y += (t.ty - t.y) * k;
      if (t.born && now < t.born) continue;
      if (t.dying && Math.abs(t.tx - t.x) < 0.05 && Math.abs(t.ty - t.y) < 0.05) { this.tiles.delete(id); continue; }
      t.scale += (1 - t.scale) * (this.reduced ? 1 : 0.3);
      t.pop = Math.max(0, t.pop - 0.08);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(this.ox, this.oy);
    ctx.fillStyle = 'rgba(20,10,60,0.55)';
    roundRect(ctx, 0, 0, this.size, this.size, 18);
    ctx.fill();
    const pad = C * 0.07;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, c * C + pad, r * C + pad, C - 2 * pad, C - 2 * pad, C * 0.16);
      ctx.fill();
    }
    const list = [...this.tiles.values()].filter((t) => !(t.born && now < t.born)).sort((a, b) => (a.dying ? -1 : 0) - (b.dying ? -1 : 0));
    for (const t of list) {
      const lvl = Math.log2(t.v) - 1;
      const hue = HUES[Math.min(HUES.length - 1, lvl)];
      const sc = t.scale * (1 + t.pop * 0.15);
      const w = (C - 2 * pad) * sc;
      const cx = t.x * C + C / 2, cy = t.y * C + C / 2;
      const g = ctx.createLinearGradient(0, cy - w / 2, 0, cy + w / 2);
      g.addColorStop(0, `hsl(${hue}, 85%, ${72 - Math.min(lvl, 8) * 2}%)`);
      g.addColorStop(1, `hsl(${hue}, 75%, ${52 - Math.min(lvl, 8) * 2}%)`);
      ctx.fillStyle = g;
      if (t.v >= 1024) { ctx.shadowColor = `hsl(${hue},90%,70%)`; ctx.shadowBlur = 16; }
      roundRect(ctx, cx - w / 2, cy - w / 2, w, w, C * 0.16);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${w * 0.42}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.fillText(tileEmoji(t.v), cx, cy - w * 0.08);
      ctx.font = `900 ${w * (t.v >= 1000 ? 0.17 : 0.2)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 3;
      ctx.strokeText(String(t.v), cx, cy + w * 0.3);
      ctx.fillText(String(t.v), cx, cy + w * 0.3);
    }
    // merge sparkles
    for (const p of this.particles) {
      if (now < p.t0) continue;
      p.x += p.vx; p.y += p.vy; p.life -= 0.035;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = `hsl(${p.hue},90%,75%)`;
      ctx.beginPath(); ctx.arc(p.x * C, p.y * C, C * 0.04, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    // "+value" popups float up
    this.popups = this.popups.filter((p) => now - p.t0 < 900);
    for (const p of this.popups) {
      const t = (now - p.t0) / 900;
      if (t < 0) continue;
      ctx.globalAlpha = 1 - t;
      ctx.font = `900 ${C * (p.big ? 0.26 : 0.22)}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeText(p.text, p.x * C, (p.y - t * 0.5) * C);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x * C, (p.y - t * 0.5) * C);
    }
    ctx.globalAlpha = 1;
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Top tile', value: `${tileEmoji(sim.best)} ${sim.best}` },
    { label: 'Moves', value: sim.moves },
  ];
}

export const HOW = `<div class="tip">🐳 <b>Swipe</b> to slide every tile. Two matching creatures that touch <b>merge</b> into the next one: 🐚 → 🦐 → 🦀 → 🐠 → 🐡 → 🐢 → 🐙 → 🦈 → 🐬 → 🐳 → 👑</div>
<div class="tip">➕ Every merge adds the new tile's number to your score. Several merges in one swipe score a <b>combo bonus</b>. The <b>Next</b> creature is shown below the board.</div>
<div class="tip">🐙 Make an <b>octopus</b> (128) and it inks away the smallest creature next to it. 🦈 A <b>shark</b> (256) gobbles every 🐚 next to it.</div>
<div class="tip">↶ Each new top creature from 🐙 128 up earns an <b>undo</b> (hold up to 2).</div>
<div class="tip">🏁 The game ends when the board is full and nothing can merge. Reach 🐳 2048 to become <b>Ocean master</b>!</div>`;

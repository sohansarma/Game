// Canvas renderer + input for the match-3 board. It animates the step lists
// produced by the engine, so visuals can never drift from the simulation.

import { SPECIAL } from './engine.js';
import { sprite, PALETTE } from './creatures.js';
import { sfx, haptic } from './audio.js';

const ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

export class MatchView {
  constructor(canvas, game, { onUpdate, onSettled, onInvalid, onCellTap, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.hooks = { onUpdate, onSettled, onInvalid, onCellTap };
    this.speed = reducedMotion ? 0.6 : 1; // duration multiplier
    this.reduced = !!reducedMotion;
    this.sprites = new Map();
    this.particles = [];
    this.effects = [];
    this.popups = [];
    this.busy = false;
    this.selected = null;
    this.cursor = null; // keyboard cursor
    this.hint = null;
    this.hintTimer = null;
    this.mode = 'swap'; // or 'hammer'
    this.viewJelly = game.jelly.map((r) => r.slice());
    this.viewCrate = game.crate.map((r) => r.slice());
    this.viewScore = game.score;
    this.shake = 0;
    this.destroyed = false;
    for (const g of game.snapshot()) this.addSprite(g, g.r);
    this.resize();
    this.bindInput();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.resetHintTimer();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.hintTimer);
    this.unbind();
  }

  // ---------- layout ----------
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const W = rect.width, H = rect.height;
    this.cell = Math.floor(Math.min(W / this.game.cols, H / this.game.rows));
    this.ox = Math.floor((W - this.cell * this.game.cols) / 2);
    this.oy = Math.floor((H - this.cell * this.game.rows) / 2);
    this.spriteSize = Math.round(this.cell * 0.9 * dpr);
  }

  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left - this.ox, y = clientY - rect.top - this.oy;
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    if (r < 0 || c < 0 || r >= this.game.rows || c >= this.game.cols) return null;
    return [r, c];
  }

  // ---------- sprites ----------
  addSprite(g, fromR) {
    this.sprites.set(g.id, {
      id: g.id, color: g.color, special: g.special,
      x: g.c, y: fromR, scale: 1, alpha: 1, flash: 0, anim: null,
    });
  }

  tween(sp, to, dur, easing = ease.outCubic) {
    return new Promise((resolve) => {
      const from = { x: sp.x, y: sp.y, scale: sp.scale, alpha: sp.alpha };
      sp.anim = { from, to, t0: performance.now(), dur: this.ff ? 1 : dur * this.speed, easing, resolve };
    });
  }

  wait(ms) {
    return new Promise((r) => setTimeout(r, this.ff ? 0 : ms * this.speed));
  }

  /** Jump every running/coming animation to its end (the engine already knows the result). */
  fastForward() {
    this.ff = true;
    for (const sp of this.sprites.values()) if (sp.anim) sp.anim.dur = 1;
  }

  // ---------- step playback ----------
  async play(steps) {
    this.busy = true;
    this.clearHint();
    for (const step of steps) {
      if (this.destroyed) return;
      await this.playStep(step);
      this.hooks.onUpdate?.(this.viewScore, step);
    }
    // safety resync with final truth
    this.resync(this.game.snapshot());
    this.viewJelly = this.game.jelly.map((r) => r.slice());
    this.viewCrate = this.game.crate.map((r) => r.slice());
    this.viewScore = this.game.score;
    this.busy = false;
    this.ff = false;
    this.hooks.onUpdate?.(this.viewScore, null);
    this.hooks.onSettled?.();
    this.resetHintTimer();
    if (this.queued) { const [a, b] = this.queued; this.queued = null; this.trySwap(a, b); }
  }

  async playStep(step) {
    switch (step.type) {
      case 'swap': {
        const ga = this.spriteAt(step.a), gb = this.spriteAt(step.b);
        if (!ga || !gb) return;
        sfx.swap();
        await Promise.all([
          this.tween(ga, { x: step.b[1], y: step.b[0] }, 160),
          this.tween(gb, { x: step.a[1], y: step.a[0] }, 160),
        ]);
        if (!step.ok) {
          sfx.bad();
          haptic(30);
          await Promise.all([
            this.tween(ga, { x: step.a[1], y: step.a[0] }, 160),
            this.tween(gb, { x: step.b[1], y: step.b[0] }, 160),
          ]);
          this.hooks.onInvalid?.();
        }
        return;
      }
      case 'transform': {
        for (const g of step.gems) {
          const sp = this.sprites.get(g.id);
          if (sp) { sp.special = g.special; sp.color = g.color; sp.flash = 1; }
        }
        sfx.special();
        await this.wait(260);
        return;
      }
      case 'clear': return this.playClear(step);
      case 'fall': return this.playFall(step);
      case 'shuffle': {
        this.toast('Shuffle!');
        const anims = [];
        for (const g of step.board) {
          const sp = this.sprites.get(g.id);
          if (sp) anims.push(this.tween(sp, { x: g.c, y: g.r }, 380));
        }
        await Promise.all(anims);
        return;
      }
      case 'bonus':
        this.toast(`+${step.moves} move${step.moves > 1 ? 's' : ''}!`, '#7CFFB2');
        sfx.coin();
        return;
      case 'finale': {
        this.toast('Tidal Finale!', '#FFD45E', 1.4);
        sfx.win();
        for (const g of step.gems) {
          const sp = this.sprites.get(g.id);
          if (sp) { sp.special = g.special; sp.flash = 1; }
          await this.wait(Math.max(25, 140 - step.gems.length * 6));
          sfx.tap();
        }
        this.viewScore += step.points;
        await this.wait(300);
        return;
      }
      default:
    }
  }

  async playClear(step) {
    const { cleared, upgraded, effects, hits, points, cascade } = step;
    // effects
    let boom = false, zap = false, pearl = false;
    for (const e of effects) {
      this.effects.push({ ...e, t0: performance.now(), dur: e.kind === 'star' ? 620 : 420 });
      if (e.kind === 'bomb') boom = true;
      else if (e.kind === 'rainbow' || e.kind === 'nova') pearl = true;
      else zap = true;
    }
    if (boom) { sfx.boom(); haptic(40); if (!this.reduced) this.shake = 1; }
    else if (!this.reduced && (cleared.length >= 10 || cascade >= 3)) this.shake = Math.max(this.shake, 0.45); // big clears land with weight
    if (pearl) { sfx.rainbow(); haptic(30); }
    if (zap) sfx.zap();
    if (cleared.length) sfx.match(cascade);
    if (upgraded.length) sfx.special();

    const anims = [];
    const goalColors = new Set((this.game.cfg.objectives || []).filter((o) => o.type === 'collect').map((o) => o.color));
    for (const g of cleared) {
      if (goalColors.has(g.color) && !this.reduced && (this.flyers ||= []).length < 24) this.flyers.push({ x: g.c + 0.5, y: g.r + 0.5, color: g.color, t0: performance.now() + Math.random() * 120 });
      const sp = this.sprites.get(g.id);
      if (!sp) continue;
      anims.push(this.tween(sp, { scale: 1.25, alpha: 0 }, 220).then(() => this.sprites.delete(g.id)));
      this.burst(g.c + 0.5, g.r + 0.5, g.color >= 0 ? PALETTE[g.color].base : '#ffffff', 6);
    }
    for (const g of upgraded) {
      const sp = this.sprites.get(g.id);
      if (sp) { sp.special = g.special; sp.color = g.color; sp.flash = 1; }
    }
    for (const h of hits) {
      if (h.kind === 'jelly') this.viewJelly[h.r][h.c] = h.left;
      else {
        this.viewCrate[h.r][h.c] = h.left;
        this.burst(h.c + 0.5, h.r + 0.5, '#c58b4c', 8);
      }
    }
    if (points && cleared.length) {
      let sx = 0, sy = 0;
      for (const g of cleared) { sx += g.c; sy += g.r; }
      const label = cascade > 1 ? `+${points}  x${cascade}` : `+${points}`;
      this.popups.push({ x: sx / cleared.length + 0.5, y: sy / cleared.length + 0.5, text: label, t0: performance.now(), color: cascade > 2 ? '#FFD45E' : '#fff' });
    }
    if (cascade === 3) this.toast('Sweet!', '#7CFFB2', 0.8);
    else if (cascade === 4) this.toast('Splashing!', '#7FD4FF', 0.9);
    else if (cascade >= 5) this.toast('Tidal!!', '#FFD45E', 1);
    this.viewScore += points;
    if (anims.length) await Promise.all(anims);
    else await this.wait(120);
  }

  async playFall(step) {
    const anims = [];
    let maxDist = 1;
    for (const m of step.moves) maxDist = Math.max(maxDist, m.toR - m.fromR);
    for (const s of step.spawns) maxDist = Math.max(maxDist, s.r - s.fromR);
    const dur = Math.min(420, 120 + maxDist * 45);
    for (const m of step.moves) {
      const sp = this.sprites.get(m.id);
      if (sp) anims.push(this.tween(sp, { y: m.toR, x: m.c }, dur * (0.6 + 0.4 * ((m.toR - m.fromR) / maxDist)), ease.inQuad));
    }
    for (const s of step.spawns) {
      this.addSprite(s, s.fromR);
      const sp = this.sprites.get(s.id);
      anims.push(this.tween(sp, { y: s.r }, dur, ease.inQuad));
    }
    await Promise.all(anims);
  }

  resync(board) {
    const seen = new Set();
    for (const g of board) {
      seen.add(g.id);
      let sp = this.sprites.get(g.id);
      if (!sp) { this.addSprite(g, g.r); sp = this.sprites.get(g.id); }
      sp.x = g.c; sp.y = g.r; sp.color = g.color; sp.special = g.special; sp.scale = 1; sp.alpha = 1; sp.anim = null;
    }
    for (const id of [...this.sprites.keys()]) if (!seen.has(id)) this.sprites.delete(id);
  }

  spriteAt([r, c]) {
    const g = this.game.gems[r]?.[c];
    // During playback the game is already ahead; find sprite by position instead.
    for (const sp of this.sprites.values()) if (Math.round(sp.x) === c && Math.round(sp.y) === r && sp.alpha > 0.5) return sp;
    return g ? this.sprites.get(g.id) : null;
  }

  burst(x, y, color, n) {
    if (this.reduced) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, color, size: 0.06 + Math.random() * 0.08 });
    }
  }

  toast(text, color = '#fff', scale = 1) {
    this.popups.push({ x: this.game.cols / 2, y: this.game.rows / 2, text, t0: performance.now(), color, big: scale, dur: 1100 });
  }

  // ---------- hints ----------
  resetHintTimer() {
    clearTimeout(this.hintTimer);
    if (this.destroyed) return;
    this.hintTimer = setTimeout(() => this.showHint(), 7000);
  }
  showHint(force) {
    if (this.busy || this.game.state !== 'playing') return;
    if (!force && this.mode !== 'swap') return;
    this.hint = this.game.smartMove();
    this.hintT0 = performance.now();
  }
  clearHint() {
    this.hint = null;
    clearTimeout(this.hintTimer);
  }

  // ---------- input ----------
  bindInput() {
    const cv = this.canvas;
    let down = null;
    const onDown = (e) => {
      if (this.busy && this.mode !== 'swap') return; // swipes are allowed mid-cascade (fast-forward)
      const cell = this.cellAt(e.clientX, e.clientY);
      if (!cell) return;
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ }
      down = { cell, x: e.clientX, y: e.clientY, moved: false };
      this.clearHint();
      this.resetHintTimer();
    };
    const onMove = (e) => {
      if (!down || down.moved || this.mode !== 'swap') return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      const th = this.cell * 0.35;
      if (Math.abs(dx) < th && Math.abs(dy) < th) return;
      down.moved = true;
      const [r, c] = down.cell;
      const to = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
      this.selected = null;
      this.trySwap(down.cell, to);
    };
    const onUp = () => {
      if (!down) return;
      const d = down;
      down = null;
      if (d.moved || this.busy) return;
      this.tapCell(d.cell);
    };
    const onKey = (e) => {
      if (this.busy || document.querySelector('.modal.open')) return;
      const k = e.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(k)) return;
      e.preventDefault();
      this.cursor ||= [Math.floor(this.game.rows / 2), Math.floor(this.game.cols / 2)];
      if (k === 'Enter' || k === ' ') return this.tapCell(this.cursor);
      const [r, c] = this.cursor;
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      const n = [Math.max(0, Math.min(this.game.rows - 1, r + d[0])), Math.max(0, Math.min(this.game.cols - 1, c + d[1]))];
      if (this.selected && e.shiftKey === false && this.selected[0] === r && this.selected[1] === c) {
        // selected + arrow = swap in that direction
        this.selected = null;
        this.trySwap([r, c], n);
      } else this.cursor = n;
    };
    const onResize = () => this.resize();
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', () => (down = null));
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    this.unbind = () => {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }

  tapCell(cell) {
    if (this.mode !== 'swap') {
      this.hooks.onCellTap?.(cell);
      return;
    }
    if (!this.game.isOpen(cell[0], cell[1])) return;
    if (!this.selected) {
      this.selected = cell;
      sfx.tap();
      return;
    }
    const [r, c] = this.selected;
    if (r === cell[0] && c === cell[1]) { this.selected = null; return; }
    if (Math.abs(r - cell[0]) + Math.abs(c - cell[1]) === 1) {
      this.selected = null;
      this.trySwap([r, c], cell);
    } else {
      this.selected = cell;
      sfx.tap();
    }
  }

  trySwap(a, b) {
    if (this.busy) {
      // don't make fast players wait: finish the current animation now, then swap
      this.queued = [a, b];
      this.fastForward();
      return;
    }
    if (!this.game.canAct()) return;
    if (!this.game.isOpen(b[0], b[1]) || !this.game.gem(a[0], a[1]) || !this.game.gem(b[0], b[1])) return;
    const res = this.game.swap(a, b);
    if (res.steps.length) this.play(res.steps);
  }

  // ---------- drawing ----------
  loop(now) {
    if (this.destroyed) return;
    this.update(now);
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  update(now) {
    for (const sp of this.sprites.values()) {
      if (sp.flash > 0) sp.flash = Math.max(0, sp.flash - 0.04);
      const a = sp.anim;
      if (!a) continue;
      const t = Math.min(1, (now - a.t0) / a.dur);
      const k = a.easing(t);
      for (const p of ['x', 'y', 'scale', 'alpha']) if (a.to[p] !== undefined) sp[p] = a.from[p] + (a.to[p] - a.from[p]) * k;
      if (t >= 1) { sp.anim = null; a.resolve(); }
    }
    const dt = 1 / 60;
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 9 * dt; p.life -= dt * 1.6;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    this.popups = this.popups.filter((p) => now - p.t0 < (p.dur || 900));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.06);
  }

  draw(now) {
    const ctx = this.ctx, dpr = this.dpr, C = this.cell;
    const g = this.game;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = this.shake ? (Math.random() - 0.5) * 8 * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * 8 * this.shake : 0;
    ctx.translate(this.ox + sx, this.oy + sy);

    // board tiles
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        if (g.hole[r][c]) continue;
        const x = c * C, y = r * C;
        ctx.fillStyle = (r + c) % 2 ? 'rgba(10,40,90,0.42)' : 'rgba(10,40,90,0.30)';
        roundRect(ctx, x + 1, y + 1, C - 2, C - 2, C * 0.16);
        ctx.fill();
        const j = this.viewJelly[r][c];
        if (j > 0) {
          ctx.fillStyle = j > 1 ? 'rgba(60,230,120,0.85)' : 'rgba(90,240,150,0.6)';
          roundRect(ctx, x + 2, y + 2, C - 4, C - 4, C * 0.16);
          ctx.fill();
          ctx.strokeStyle = j > 1 ? '#eaffb0' : 'rgba(220,255,200,0.95)';
          ctx.lineWidth = j > 1 ? 4 : 2.5;
          ctx.stroke();
          // little algae fronds
          ctx.strokeStyle = 'rgba(20,110,50,0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + C * 0.2, y + C * 0.85); ctx.quadraticCurveTo(x + C * 0.12, y + C * 0.7, x + C * 0.22, y + C * 0.6);
          ctx.moveTo(x + C * 0.8, y + C * 0.85); ctx.quadraticCurveTo(x + C * 0.9, y + C * 0.72, x + C * 0.78, y + C * 0.62);
          ctx.stroke();
        }
      }

    // selection / cursor / hint
    const hl = (cell, color, w = 3) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      roundRect(ctx, cell[1] * C + 2, cell[0] * C + 2, C - 4, C - 4, C * 0.18);
      ctx.stroke();
    };
    if (this.selected) hl(this.selected, '#fff', 3);
    if (this.cursor) hl(this.cursor, '#FFD45E', 2);

    // gems
    let hintIds = null;
    if (this.hint) {
      const [a, b] = this.hint;
      hintIds = new Set([g.gem(a[0], a[1])?.id, g.gem(b[0], b[1])?.id]);
    }
    const S = this.spriteSize;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, g.cols * C, g.rows * C);
    ctx.clip();
    for (const sp of this.sprites.values()) {
      if (sp.alpha <= 0.01) continue;
      let scale = sp.scale;
      let yoff = 0;
      if (hintIds && hintIds.has(sp.id)) {
        const t = (now - this.hintT0) / 1000;
        scale *= 1 + 0.08 * Math.sin(t * 8);
        yoff = -Math.abs(Math.sin(t * 4)) * C * 0.06;
      }
      if (sp.special === SPECIAL.RAINBOW && !this.reduced) scale *= 1 + 0.04 * Math.sin(now / 200);
      const img = sprite(sp.color, sp.special, S);
      const size = C * 0.9 * scale;
      const cx = sp.x * C + C / 2, cy = sp.y * C + C / 2 + yoff;
      ctx.globalAlpha = sp.alpha;
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      if (sp.flash > 0) {
        ctx.globalAlpha = sp.flash * 0.7;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // crates (drawn over empty cells)
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) {
        const hp = this.viewCrate[r][c];
        if (hp > 0) drawCrate(ctx, c * C, r * C, C, hp);
      }

    // effects
    for (const e of this.effects) {
      const t = (now - e.t0) / e.dur;
      ctx.globalAlpha = 1 - t;
      if (e.kind === 'line') {
        const w = (e.width || 1) * C * (0.5 + 0.5 * (1 - t));
        ctx.fillStyle = 'rgba(180,240,255,0.85)';
        if (e.dir === 'h') ctx.fillRect(0, e.r * C + C / 2 - w / 2, g.cols * C, w);
        else ctx.fillRect(e.c * C + C / 2 - w / 2, 0, w, g.rows * C);
      } else if (e.kind === 'bomb' || e.kind === 'nova') {
        const rad = (e.kind === 'nova' ? Math.max(g.rows, g.cols) : (e.radius + 0.5)) * C * (0.4 + t);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 6 * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(e.c * C + C / 2, e.r * C + C / 2, rad, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === 'star') {
        const k = Math.min(1, t * 1.6);
        const x0 = e.c * C + C / 2, y0 = e.r * C + C / 2, x1 = e.tc * C + C / 2, y1 = e.tr * C + C / 2;
        const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - C * 1.2; // a little arc
        const qx = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * mx + k * k * x1;
        const qy = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * my + k * k * y1;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,200,120,0.55)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, qx, qy); ctx.stroke();
        ctx.font = `${C * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
        ctx.save(); ctx.translate(qx, qy); ctx.rotate(k * Math.PI * 2); ctx.fillText('⭐', 0, 0); ctx.restore();
      } else if (e.kind === 'rainbow') {
        ctx.strokeStyle = `hsl(${(now / 3) % 360},90%,75%)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [r, c] of e.targets) {
          ctx.moveTo(e.c * C + C / 2, e.r * C + C / 2);
          ctx.lineTo(c * C + C / 2, r * C + C / 2);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // collected creatures swim up to the goal counter above the board
    if (this.flyers?.length) {
      for (const f of this.flyers) {
        const t = Math.max(0, Math.min(1, (now - f.t0) / 520));
        const e = t * t * (3 - 2 * t);
        const x = (f.x + (g.cols / 2 - f.x) * e) * C, y = (f.y + (-0.8 - f.y) * e) * C - Math.sin(e * Math.PI) * C;
        ctx.globalAlpha = 1 - t * 0.6;
        const sz = C * (0.7 - e * 0.3);
        ctx.drawImage(sprite(f.color, 0, Math.round(sz * this.dpr)), x - sz / 2, y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      this.flyers = this.flyers.filter((f) => now - f.t0 < 520);
    }

    // particles
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * C, p.y * C, p.size * C, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // popups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const dur = p.dur || 900;
      const t = (now - p.t0) / dur;
      const big = p.big || 0;
      const size = big ? C * 0.9 * big * (t < 0.15 ? ease.outBack(t / 0.15) : 1) : C * 0.38;
      ctx.font = `800 ${Math.max(10, size)}px ui-rounded, "Nunito", system-ui, sans-serif`;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const y = (p.y - (big ? 0 : t * 0.8)) * C;
      ctx.lineWidth = big ? 6 : 4;
      ctx.strokeStyle = 'rgba(10,30,70,0.8)';
      ctx.strokeText(p.text, p.x * C, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x * C, y);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCrate(ctx, x, y, C, hp) {
  const p = C * 0.06;
  ctx.fillStyle = hp > 1 ? '#8a5a2b' : '#b77b3f';
  roundRect(ctx, x + p, y + p, C - 2 * p, C - 2 * p, C * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#5a3816';
  ctx.lineWidth = Math.max(2, C * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + p * 2, y + p * 2); ctx.lineTo(x + C - p * 2, y + C - p * 2);
  ctx.moveTo(x + C - p * 2, y + p * 2); ctx.lineTo(x + p * 2, y + C - p * 2);
  ctx.stroke();
  // barnacles
  ctx.fillStyle = '#e8e2cf';
  for (const [bx, by] of [[0.25, 0.3], [0.7, 0.72], [0.72, 0.28]]) {
    ctx.beginPath();
    ctx.arc(x + C * bx, y + C * by, C * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  if (hp > 1) {
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${C * 0.3}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(hp), x + C / 2, y + C / 2);
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Canvas renderer + drag-and-drop input for Reef Blocks.

import { PIECES, SIZE } from './blocks.js';
import { PALETTE } from './creatures.js';
import { roundRect } from './matchview.js';
import { sfx, haptic } from './audio.js';

export class BlocksView {
  constructor(canvas, game, { onPlaced, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.onPlaced = onPlaced;
    this.reduced = !!reducedMotion;
    this.drag = null;
    this.particles = [];
    this.flashes = [];
    this.popups = [];
    this.trayAnim = [0, 0, 0];
    this.destroyed = false;
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
    const W = rect.width, H = rect.height;
    // board takes ~ 68% of height, tray the rest
    this.cell = Math.floor(Math.min(W * 0.94 / SIZE, (H * 0.7) / SIZE));
    this.bx = Math.floor((W - this.cell * SIZE) / 2);
    this.by = Math.floor(Math.max(H * 0.02, 28)); // room above the board for the combo meter
    this.trayY = this.by + this.cell * SIZE + Math.max(12, H * 0.03);
    this.trayH = H - this.trayY - 6;
    this.trayCell = Math.min(this.cell * 0.66, this.trayH / 5.2);
    this.W = W;
  }

  slotCenter(i) {
    return [this.W * (i * 2 + 1) / 6, this.trayY + this.trayH / 2];
  }

  bind() {
    const cv = this.canvas;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e) => {
      if (this.game.state !== 'playing') return;
      const [x, y] = local(e);
      if (y < this.trayY - 10) return;
      const slot = Math.min(2, Math.max(0, Math.floor(x / (this.W / 3))));
      if (!this.game.tray[slot]) return;
      try { cv.setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ }
      // lift the piece above the finger so it stays visible
      const lift = e.pointerType === 'mouse' ? this.cell * 0.5 : this.cell * 2.2;
      this.drag = { slot, x, y, lift };
      sfx.tap();
    };
    const move = (e) => {
      if (!this.drag) return;
      const [x, y] = local(e);
      this.drag.x = x;
      this.drag.y = y;
    };
    const up = () => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      const pos = this.dropCell(d);
      if (pos && this.game.canPlace(this.game.tray[d.slot].piece, pos[0], pos[1])) {
        const color = this.game.tray[d.slot].color;
        const res = this.game.place(d.slot, pos[0], pos[1]);
        if (res.ok) this.afterPlace(res, color);
      } else {
        haptic(20);
        sfx.bad?.();
        const [sx, sy] = this.slotCenter(d.slot);
        this.returning = { slot: d.slot, x0: d.x, y0: d.y - d.lift, x1: sx, y1: sy, t0: performance.now() };
      }
    };
    // keyboard: 1/2/3 pick piece, arrows move ghost, Enter place
    const key = (e) => {
      if (document.querySelector('.modal.open') || this.game.state !== 'playing') return;
      if (['1', '2', '3'].includes(e.key)) {
        const s = Number(e.key) - 1;
        if (this.game.tray[s]) this.kb = { slot: s, r: 0, c: 0 };
      } else if (this.kb && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        this.kb.r = Math.max(0, Math.min(SIZE - 1, this.kb.r + d[0]));
        this.kb.c = Math.max(0, Math.min(SIZE - 1, this.kb.c + d[1]));
      } else if (this.kb && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        const t = this.game.tray[this.kb.slot];
        if (t && this.game.canPlace(t.piece, this.kb.r, this.kb.c)) {
          const res = this.game.place(this.kb.slot, this.kb.r, this.kb.c);
          if (res.ok) this.afterPlace(res, t.color);
          this.kb = null;
        }
      } else if (e.key === 'Escape') this.kb = null;
    };
    const resize = () => this.resize();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => (this.drag = null));
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

  // top-left board cell where the dragged piece would land
  dropCell(d) {
    const t = this.game.tray[d.slot];
    if (!t) return null;
    const p = PIECES[t.piece];
    const C = this.cell;
    const px = d.x - (p.w * C) / 2, py = d.y - d.lift - (p.h * C) / 2;
    const fx = (px - this.bx) / C, fy = (py - this.by) / C;
    const c = Math.round(fx), r = Math.round(fy);
    if (r < -1 || c < -1 || r > SIZE || c > SIZE) return null;
    if (this.game.canPlace(t.piece, r, c)) return [r, c];
    // forgiving drops: the nearest legal spot close to where the piece is
    let best = null, bestD = 0.75;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = Math.floor(fy) + dr + (fy % 1 > 0.5 ? 1 : 0), cc = Math.floor(fx) + dc + (fx % 1 > 0.5 ? 1 : 0);
      if (!this.game.canPlace(t.piece, rr, cc)) continue;
      const dist = Math.hypot(rr - fy, cc - fx);
      if (dist < bestD) { bestD = dist; best = [rr, cc]; }
    }
    return best || [r, c];
  }

  afterPlace(res, color) {
    sfx.place();
    haptic(10);
    const C = this.cell;
    const now = performance.now();
    if (res.lines) {
      sfx.lines(res.lines, res.combo);
      if (res.lines >= 2) haptic(35);
      for (const [r, c, col] of res.clearedCells) {
        this.flashes.push({ r, c, color: col, t0: now });
        this.burst(this.bx + (c + 0.5) * C, this.by + (r + 0.5) * C, PALETTE[col]?.base || '#fff', this.reduced ? 1 : 3);
      }
      const power = res.lines + (res.combo - 1);
      const call = power >= 6 ? 'UNREAL!' : power >= 4 ? 'Amazing!' : power >= 3 ? 'Great!' : power >= 2 ? 'Good!' : '';
      if (call) this.popup(call, power >= 4 ? '#FF9AD5' : '#7FD4FF');
      if (res.combo > 1) this.popup(`Combo x${res.combo}`, '#FFD45E', 0.4);
      if (!this.reduced && res.lines >= 2) this.shake = Math.min(1, 0.35 + res.lines * 0.15);
      if (res.perfect) {
        this.popup('✨ Perfect Clear! ✨', '#7CFFB2', -0.4);
        sfx.win();
        haptic(60);
        if (!this.reduced) for (let i = 0; i < 40; i++) this.burst(this.bx + Math.random() * SIZE * C, this.by + Math.random() * SIZE * C, PALETTE[i % 6]?.base || '#fff', 2);
      }
    }
    this.popups.push({ x: this.W / 2, y: this.by + SIZE * C * 0.15, text: `+${res.points}`, t0: now, small: true, color: '#fff' });
    if (res.refilled) this.trayAnim = [1, 1, 1];
    void color;
    this.onPlaced?.(res);
  }

  popup(text, color, dy = 0) {
    this.popups.push({ x: this.W / 2, y: this.by + this.cell * SIZE * (0.5 + dy * 0.3), text, color, t0: performance.now() });
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 1, color, s: 2 + Math.random() * 4 });
    }
  }

  loop(now) {
    if (this.destroyed) return;
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  drawBlock(x, y, s, color, alpha = 1) {
    const ctx = this.ctx;
    const p = PALETTE[color] || PALETTE[0];
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, p.light);
    g.addColorStop(1, p.base);
    ctx.fillStyle = g;
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, s * 0.18);
    ctx.fill();
    ctx.strokeStyle = p.dark;
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, x + s * 0.18, y + s * 0.14, s * 0.4, s * 0.16, s * 0.08);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 9 * this.shake, (Math.random() - 0.5) * 9 * this.shake);
      this.shake = Math.max(0, this.shake - 0.05);
    }

    // board background
    ctx.fillStyle = 'rgba(8,30,70,0.45)';
    roundRect(ctx, this.bx - 6, this.by - 6, C * SIZE + 12, C * SIZE + 12, 14);
    ctx.fill();
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
        roundRect(ctx, this.bx + c * C + 1, this.by + r * C + 1, C - 2, C - 2, C * 0.15);
        ctx.fill();
      }

    // danger: the board is nearly full
    const filledN = g.board.flat().filter((v) => v !== -1).length;
    if (filledN > 44) {
      const k = Math.min(1, (filledN - 44) / 12) * (0.5 + 0.5 * Math.sin(now / 260));
      ctx.strokeStyle = `rgba(255,90,90,${0.25 + k * 0.45})`;
      ctx.lineWidth = 4;
      roundRect(ctx, this.bx - 6, this.by - 6, C * SIZE + 12, C * SIZE + 12, 14);
      ctx.stroke();
    }
    // combo window: dots show how many placements you have left to keep it alive
    if (g.combo > 0 && g.state === 'playing') {
      const left = Math.max(0, 3 - g.sinceClear);
      const y = this.by - 16, x0 = this.bx + C * SIZE / 2 - 60;
      ctx.font = '800 12px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFD45E';
      ctx.fillText(`Combo x${g.combo}`, x0, y);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < left ? '#FFD45E' : 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(x0 + 82 + i * 14, y, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ghost preview + would-clear highlight
    let ghost = null;
    const active = this.drag || (this.kb && { slot: this.kb.slot });
    if (active) {
      const t = g.tray[active.slot];
      const pos = this.drag ? this.dropCell(this.drag) : [this.kb.r, this.kb.c];
      if (t && pos && g.canPlace(t.piece, pos[0], pos[1])) ghost = { t, pos };
      else if (t && pos) ghost = { t, pos, bad: true };
    }
    let clearRows = new Set(), clearCols = new Set();
    if (ghost && !ghost.bad) {
      const cells = new Set(PIECES[ghost.t.piece].cells.map(([dr, dc]) => (ghost.pos[0] + dr) * 8 + ghost.pos[1] + dc));
      const filled = (r, c) => g.board[r][c] !== -1 || cells.has(r * 8 + c);
      for (let r = 0; r < SIZE; r++) if ([...Array(SIZE).keys()].every((c) => filled(r, c))) clearRows.add(r);
      for (let c = 0; c < SIZE; c++) if ([...Array(SIZE).keys()].every((r) => filled(r, c))) clearCols.add(c);
    }

    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const v = g.board[r][c];
        if (v === -1) continue;
        const glow = clearRows.has(r) || clearCols.has(c);
        this.drawBlock(this.bx + c * C, this.by + r * C, C, glow ? ghost.t.color : v);
        if (glow) {
          ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.15 * Math.sin(now / 90)})`;
          roundRect(ctx, this.bx + c * C + 1, this.by + r * C + 1, C - 2, C - 2, C * 0.15);
          ctx.fill();
        }
      }
    if (ghost) {
      for (const [dr, dc] of PIECES[ghost.t.piece].cells) {
        const r = ghost.pos[0] + dr, c = ghost.pos[1] + dc;
        if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) continue;
        if (ghost.bad) {
          ctx.strokeStyle = '#ff6b6b';
          ctx.lineWidth = 2;
          roundRect(ctx, this.bx + c * C + 2, this.by + r * C + 2, C - 4, C - 4, C * 0.15);
          ctx.stroke();
        } else this.drawBlock(this.bx + c * C, this.by + r * C, C, ghost.t.color, 0.45);
      }
    }

    // rescue: trapped fish peek out of their coral
    if (g.fish?.size) {
      ctx.font = `${Math.round(C * 0.62)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const f of g.fish) {
        const [fr, fc] = f.split(',').map(Number);
        const bob = this.reduced ? 0 : Math.sin(now / 300 + fr + fc) * C * 0.04;
        ctx.fillText('🐠', this.bx + fc * C + C / 2, this.by + fr * C + C / 2 + bob);
      }
    }
    // clear flashes
    this.flashes = this.flashes.filter((f) => now - f.t0 < 350);
    for (const f of this.flashes) {
      const t = (now - f.t0) / 350;
      const s = C * (1 - t * 0.6);
      ctx.globalAlpha = 1 - t;
      this.drawBlock(this.bx + f.c * C + (C - s) / 2, this.by + f.r * C + (C - s) / 2, s, f.color, 1 - t);
      ctx.globalAlpha = 1;
    }

    // tray
    for (let i = 0; i < 3; i++) {
      const t = g.tray[i];
      if (!t || (this.drag && this.drag.slot === i)) continue;
      if (this.returning && this.returning.slot === i) continue;
      const p = PIECES[t.piece];
      const fits = g.fitsAnywhere(t.piece);
      if (this.trayAnim[i] > 0) this.trayAnim[i] = Math.max(0, this.trayAnim[i] - 0.06);
      const s = this.trayCell * (1 - this.trayAnim[i] * 0.6);
      const [cx, cy] = this.slotCenter(i);
      const sel = this.kb && this.kb.slot === i;
      if (sel) {
        ctx.strokeStyle = '#FFD45E';
        ctx.lineWidth = 2;
        roundRect(ctx, cx - this.W / 6 + 6, this.trayY, this.W / 3 - 12, this.trayH, 12);
        ctx.stroke();
      }
      for (const [dr, dc] of p.cells) {
        this.drawBlock(cx - (p.w * s) / 2 + dc * s, cy - (p.h * s) / 2 + dr * s, s, t.color, fits ? 1 : 0.3);
      }
    }
    // a rejected piece slides back to its slot
    if (this.returning) {
      const r = this.returning, t = g.tray[r.slot];
      const k = Math.min(1, (now - r.t0) / 220);
      if (!t || k >= 1) this.returning = null;
      else {
        const e = 1 - (1 - k) * (1 - k), p = PIECES[t.piece];
        const s2 = C + (this.trayCell - C) * e;
        const x = r.x0 + (r.x1 - r.x0) * e - (p.w * s2) / 2, y = r.y0 + (r.y1 - r.y0) * e - (p.h * s2) / 2;
        for (const [dr, dc] of p.cells) this.drawBlock(x + dc * s2, y + dr * s2, s2, t.color, 0.95);
      }
    }
    // dragged piece
    if (this.drag) {
      const t = g.tray[this.drag.slot];
      if (t) {
        const p = PIECES[t.piece];
        const x0 = this.drag.x - (p.w * C) / 2, y0 = this.drag.y - this.drag.lift - (p.h * C) / 2;
        for (const [dr, dc] of p.cells) this.drawBlock(x0 + dc * C, y0 + dr * C, C, t.color, 0.95);
      }
    }

    // particles
    const dt = 1 / 60;
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt * 1.5;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);

    // popups
    this.popups = this.popups.filter((p) => now - p.t0 < 1000);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const t = (now - p.t0) / 1000;
      const size = p.small ? C * 0.45 : C * 0.8;
      ctx.font = `800 ${size}px ui-rounded, "Nunito", system-ui, sans-serif`;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      const y = p.y - t * C * (p.small ? 1.2 : 0.5);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(10,30,70,0.85)';
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
}

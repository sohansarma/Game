// Deep Miner renderer + input.
import { W, T, INFO, SHOP_ITEMS, SHOP_EVERY } from './miner.js';
import { sfx, haptic } from '../audio.js';
import { roundRect } from '../matchview.js';

const COLORS = {
  [T.DIRT]: ['#8a5a33', '#6e4526'],
  [T.STONE]: ['#7d7f8a', '#5d5f6a'],
  [T.HARD]: ['#4a4c58', '#33343e'],
  [T.SHOP]: ['#b07a3c', '#7a4f22'],
  [T.BEDROCK]: ['#1c1d24', '#111217'],
};
const GEM = {
  [T.COPPER]: '#e07b39',
  [T.SILVER]: '#d9dde6',
  [T.GOLD]: '#ffd23f',
  [T.EMERALD]: '#2ee88a',
  [T.DIAMOND]: '#7fe9ff',
  [T.CRYSTAL]: '#4dd6ff',
};

export default class MinerView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.camY = sim.y;
    this.px = sim.x;
    this.py = sim.y;
    this.particles = [];
    this.popups = [];
    this.flash = 0;
    this.shake = 0;
    this.destroyed = false;
    this.resize();
    this.bind();
    this.renderControls();
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
    this.cell = Math.floor(rect.width / W);
    this.ox = Math.floor((rect.width - this.cell * W) / 2);
    this.H = rect.height;
  }

  bind() {
    const cv = this.canvas;
    let start = null;
    const down = (e) => { start = { x: e.clientX, y: e.clientY }; cv.setPointerCapture?.(e.pointerId); };
    const up = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      start = null;
      let dir;
      if (Math.hypot(dx, dy) > 24) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
      else {
        // tap: direction from the miner to the tapped point
        const r = cv.getBoundingClientRect();
        const tx = e.clientX - r.left - this.ox - (this.px + 0.5) * this.cell;
        const ty = e.clientY - r.top - this.screenY(this.py + 0.5);
        dir = Math.abs(tx) > Math.abs(ty) ? (tx > 0 ? 'r' : 'l') : (ty > 0 ? 'd' : 'u');
      }
      this.act(dir);
    };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      const m = { ArrowLeft: 'l', ArrowRight: 'r', ArrowDown: 'd', ArrowUp: 'u', a: 'l', d: 'r', s: 'd', w: 'u' }[e.key];
      if (m) { e.preventDefault(); this.act(m); }
      if (e.key === 'b') this.useBomb();
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

  act(dir) {
    if (this.sim.over) return;
    const res = this.sim.move(dir);
    if (!res.ok) {
      sfx.bad();
      haptic(20);
      const d = { l: [-1, 0], r: [1, 0], d: [0, 1], u: [0, -1] }[dir];
      const t = this.sim.get(this.sim.x + d[0], this.sim.y + d[1]);
      if (t !== T.BEDROCK && t !== T.SHOP && !(dir === 'u' && t !== T.AIR)) this.popup('Not enough energy!', this.sim.x, this.sim.y, '#ff8a80');
      return;
    }
    this.handle(res.events);
  }

  useBomb() {
    const res = this.sim.bomb();
    if (res.ok) this.handle(res.events);
  }

  buy(item) {
    const res = this.sim.buy(item);
    if (res.ok) { sfx.coin(); this.handle(res.events); }
    else sfx.bad();
  }

  handle(events) {
    let dug = false;
    for (const e of events) {
      if (e.kind === 'dig') {
        dug = true;
        const col = GEM[e.t] || (COLORS[e.t] || COLORS[T.DIRT])[0];
        this.burst(e.x + 0.5, e.y + 0.5, e.t === T.LAVA ? '#ff6a00' : col, GEM[e.t] ? 10 : 5);
      } else if (e.kind === 'gold') {
        this.popup(`+${e.amount}`, e.x, e.y, '#ffd23f');
        if (e.amount >= 150) { sfx.rainbow(); haptic(30); } else if (e.amount >= 50) sfx.star(1); else sfx.coin();
      } else if (e.kind === 'energy') {
        this.popup(`⚡+${e.amount}`, e.x, e.y, '#4dd6ff');
        sfx.special();
      } else if (e.kind === 'hurt') {
        this.popup(`🔥-${e.amount}`, e.x, e.y, '#ff6a00');
        sfx.lose();
        haptic(60);
        this.flash = 1;
      } else if (e.kind === 'boom') {
        sfx.boom();
        haptic(50);
        if (!this.reduced) this.shake = 1;
      } else if (e.kind === 'depth') {
        this.popup(`${e.y} m – Shop ahead!`, 2, e.y - 1, '#7CFFB2', true);
      } else if (e.kind === 'shop') {
        sfx.win();
        this.popup('⛺ Mine shop!', 2, this.sim.y - 1, '#ffd23f', true);
      } else if (e.kind === 'fall') {
        sfx.swap();
      }
    }
    if (dug) sfx.place();
    this.renderControls();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over) setTimeout(() => this.hooks.onOver?.(this.sim), 700);
  }

  renderControls() {
    const s = this.sim;
    const shop = s.atShop();
    const btn = (id, label, dis = false, cls = 'ghost') => `<button class="btn sm ${cls}" data-a="${id}" ${dis ? 'disabled' : ''}>${label}</button>`;
    this.controls.innerHTML = `
      <div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px">
        ${shop ? Object.entries(SHOP_ITEMS).map(([k, it]) => btn('buy:' + k, `${it.name} · 💰${it.price(s)}`, s.gold < it.price(s), 'blue')).join('') : ''}
        ${btn('bomb', `💣 Bomb ×${s.bombs}`, s.bombs <= 0, 'red')}
        ${btn('quit', '🏁 Cash out')}
      </div>`;
    for (const b of this.controls.querySelectorAll('[data-a]')) {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'bomb') this.useBomb();
        else if (a === 'quit') this.hooks.onQuit?.();
        else if (a.startsWith('buy:')) this.buy(a.slice(4));
      };
    }
  }

  popup(text, x, y, color, big) {
    this.popups.push({ text, x: x + 0.5, y: y + 0.5, color, t0: performance.now(), big });
  }

  burst(x, y, color, n) {
    if (this.reduced) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, color, size: 0.05 + Math.random() * 0.07 });
    }
  }

  screenY(row) {
    return (row - this.camY) * this.cell + this.H * 0.35;
  }

  loop(now) {
    if (this.destroyed) return;
    const s = this.sim;
    const k = this.reduced ? 1 : 0.25;
    this.px += (s.x - this.px) * k;
    this.py += (s.y - this.py) * k;
    this.camY += (s.y - this.camY) * (this.reduced ? 1 : 0.12);
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, C = this.cell, s = this.sim;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const Wpx = this.canvas.width / this.dpr;
    ctx.clearRect(0, 0, Wpx, this.H);
    const sh = this.shake ? (Math.random() - 0.5) * 10 * this.shake : 0;
    if (this.shake) this.shake = Math.max(0, this.shake - 0.05);
    ctx.save();
    ctx.translate(this.ox + sh, 0);

    const top = Math.floor(this.camY - this.H * 0.35 / C) - 1;
    const bottom = top + Math.ceil(this.H / C) + 2;
    // sky
    const skyBottom = this.screenY(0.6);
    if (skyBottom > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, skyBottom);
      g.addColorStop(0, '#7fd4f5');
      g.addColorStop(1, '#bfe9ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W * C, skyBottom);
    }
    for (let y = Math.max(0, top); y <= bottom; y++) {
      const sy = this.screenY(y);
      for (let x = 0; x < W; x++) {
        const t = s.get(x, y);
        this.drawTile(t, x * C, sy, C, x, y, now);
      }
      if (y > 0 && y % 10 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `700 ${C * 0.26}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(`${y} m`, 3, sy + C * 0.3);
      }
    }

    // miner
    const mx = (this.px + 0.5) * C, my = this.screenY(this.py + 0.5);
    this.drawMiner(mx, my, C);

    // darkness with lamp light (deeper = darker)
    const dark = Math.min(0.88, Math.max(0, (s.y - 3) * 0.02));
    if (dark > 0) {
      const r = C * Math.max(2.4, 4.2 - s.y * 0.01) * (1 + 0.15 * s.pick);
      const g = ctx.createRadialGradient(mx, my, C * 0.6, mx, my, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(5,3,10,${dark})`);
      ctx.fillStyle = g;
      ctx.fillRect(-this.ox, 0, Wpx, this.H);
    }

    // particles
    for (const p of this.particles) {
      p.x += p.vx / 60; p.y += p.vy / 60; p.vy += 9 / 60; p.life -= 1.4 / 60;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * C, this.screenY(p.y), p.size * C, p.size * C);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);

    // popups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.popups = this.popups.filter((p) => now - p.t0 < 1200);
    for (const p of this.popups) {
      const t = (now - p.t0) / 1200;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.font = `800 ${C * (p.big ? 0.5 : 0.38)}px ui-rounded, system-ui, sans-serif`;
      const x = p.big ? (W * C) / 2 : p.x * C;
      const y = this.screenY(p.y) - t * C;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,80,0,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, Wpx, this.H);
      this.flash = Math.max(0, this.flash - 0.04);
    }
  }

  drawTile(t, x, y, C, gx, gy, now) {
    const ctx = this.ctx;
    if (t === T.AIR) {
      if (gy > 0) {
        ctx.fillStyle = '#1b130e';
        ctx.fillRect(x, y, C, C);
      }
      return;
    }
    const isGem = GEM[t];
    const baseType = isGem ? (gy > 30 ? T.STONE : T.DIRT) : COLORS[t] ? t : T.DIRT;
    const [c1, c2] = COLORS[baseType];
    ctx.fillStyle = (gx + gy) % 2 ? c1 : c2;
    ctx.fillRect(x, y, C + 0.5, C + 0.5);
    // speckles (stable per cell)
    const h = (gx * 73856093) ^ (gy * 19349663);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 3; i++) {
      const sx = ((h >> (i * 5)) & 31) / 31, syy = ((h >> (i * 5 + 3)) & 31) / 31;
      ctx.fillRect(x + sx * C * 0.85, y + syy * C * 0.85, C * 0.09, C * 0.09);
    }
    if (t === T.HARD) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + C * 0.2, y + C * 0.3); ctx.lineTo(x + C * 0.5, y + C * 0.5); ctx.lineTo(x + C * 0.4, y + C * 0.8);
      ctx.stroke();
    }
    if (isGem) {
      const col = GEM[t];
      const cx = x + C / 2, cy = y + C / 2;
      const pulse = t === T.CRYSTAL && !this.reduced ? 1 + 0.08 * Math.sin(now / 200 + gx) : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      if (t === T.CRYSTAL || t === T.DIAMOND || t === T.EMERALD) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      if (t === T.CRYSTAL) {
        ctx.beginPath();
        ctx.moveTo(0, -C * 0.34); ctx.lineTo(C * 0.18, 0); ctx.lineTo(0, C * 0.34); ctx.lineTo(-C * 0.18, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (t === T.DIAMOND || t === T.EMERALD) {
        ctx.beginPath();
        ctx.moveTo(-C * 0.26, -C * 0.08); ctx.lineTo(-C * 0.12, -C * 0.24); ctx.lineTo(C * 0.12, -C * 0.24);
        ctx.lineTo(C * 0.26, -C * 0.08); ctx.lineTo(0, C * 0.28); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        for (const [ox, oy, r] of [[-0.15, -0.1, 0.12], [0.12, -0.05, 0.1], [-0.02, 0.15, 0.11]]) {
          ctx.beginPath(); ctx.arc(ox * C, oy * C, r * C, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-C * 0.1, -C * 0.14, C * 0.06, C * 0.06);
      ctx.restore();
    }
    if (t === T.TNT) {
      ctx.fillStyle = '#d63031';
      roundRect(ctx, x + C * 0.12, y + C * 0.2, C * 0.76, C * 0.6, C * 0.08);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${C * 0.26}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', x + C / 2, y + C / 2);
    }
    if (t === T.CHEST) {
      ctx.fillStyle = '#c9871e';
      roundRect(ctx, x + C * 0.15, y + C * 0.3, C * 0.7, C * 0.5, C * 0.08);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x + C * 0.15, y + C * 0.45, C * 0.7, C * 0.08);
      ctx.fillRect(x + C * 0.45, y + C * 0.4, C * 0.1, C * 0.18);
    }
    if (t === T.LAVA) {
      const g = ctx.createLinearGradient(x, y, x, y + C);
      const f = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 300 + gx * 2);
      g.addColorStop(0, `rgb(255,${140 + 60 * f},0)`);
      g.addColorStop(1, '#c0392b');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, C + 0.5, C + 0.5);
    }
    if (t === T.SHOP) {
      ctx.strokeStyle = '#5a3816';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, C - 2, C - 2);
      if (gx === 1) {
        ctx.font = `${C * 0.55}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⛺', x + C / 2, y + C / 2);
      }
    }
    if (gy > 0 && gy % SHOP_EVERY === SHOP_EVERY - 1 && t === T.AIR) {
      // nothing – placeholder for future decorations
    }
  }

  drawMiner(x, y, C) {
    const ctx = this.ctx;
    // body
    ctx.fillStyle = '#ff5a5f';
    ctx.beginPath();
    ctx.ellipse(x, y + C * 0.08, C * 0.3, C * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b8262c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // helmet + lamp
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(x, y - C * 0.06, C * 0.22, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    ctx.arc(x, y - C * 0.2, C * 0.06, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    for (const dx of [-0.09, 0.09]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x + dx * C, y + C * 0.06, C * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b2f';
      ctx.beginPath(); ctx.arc(x + dx * C, y + C * 0.07, C * 0.028, 0, Math.PI * 2); ctx.fill();
    }
    // pickaxe
    ctx.strokeStyle = '#8a5a33';
    ctx.lineWidth = C * 0.06;
    ctx.beginPath(); ctx.moveTo(x + C * 0.25, y + C * 0.15); ctx.lineTo(x + C * 0.42, y - C * 0.15); ctx.stroke();
    ctx.strokeStyle = '#c9ced8';
    ctx.lineWidth = C * 0.07;
    ctx.beginPath(); ctx.arc(x + C * 0.42, y - C * 0.05, C * 0.14, -2.4, -0.7); ctx.stroke();
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Energy', value: `⚡ ${sim.energy}` , warn: sim.energy < 12 },
    { label: 'Gold', value: `💰 ${sim.gold}` },
    { label: 'Depth', value: `${sim.y} m` },
  ];
}

export const HOW = `<div class="tip">⛏️ <b>Swipe or tap</b> left, right or down to dig. Every block costs <b>⚡ energy</b> – harder rock costs more.</div>
<div class="tip">💎 Ores give gold (deeper = richer: copper → silver → gold → emerald → diamond). <b>Energy crystals</b> refill you, <b>TNT</b> blasts a 3×3 area, <b>chests</b> hold surprises and <b>lava</b> burns 20 energy.</div>
<div class="tip">⛺ Every 25 m there's a <b>mine shop</b>: buy energy, a better pickaxe (cheaper digging, brighter lamp) or bombs.</div>
<div class="tip">🏆 Score = gold earned + 10 per metre of depth. The run ends when you can't dig anymore – or cash out any time.</div>`;

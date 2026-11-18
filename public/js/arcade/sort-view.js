// Sort Splash renderer + input.
import { CAP } from './sort.js';
import { sfx, haptic } from '../audio.js';
import { roundRect } from '../matchview.js';

const BALL = [
  ['#ff5a5f', '●'], ['#ffb627', '▲'], ['#a259ff', '■'], ['#35c46a', '◆'], ['#2fb8ff', '★'],
  ['#ff6fb5', '♥'], ['#ffffff', '✚'], ['#8d6e63', '☾'], ['#00bfa5', '♣'],
];

export default class SortView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.sel = null;
    this.flying = null;
    this.banner = null;
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
    this.W = rect.width;
    this.H = rect.height;
  }

  layout() {
    return this.layoutFor(this.sim.tubes.length);
  }

  layoutFor(n) {
    const perRow = n <= 6 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / perRow);
    const tw = Math.min(64, (this.W - 16) / perRow - 10);
    const ball = tw * 0.78;
    const th = ball * CAP + tw * 0.5;
    const rowH = Math.min(this.H / rows, th + 50);
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const totalW = inRow * (tw + 10) - 10;
      const x = (this.W - totalW) / 2 + col * (tw + 10);
      const y = (this.H - rows * rowH) / 2 + row * rowH + (rowH - th) / 2 + 20;
      out.push({ x, y, w: tw, h: th, ball });
    }
    return out;
  }

  bind() {
    const tap = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const L = this.layout();
      const i = L.findIndex((t) => x >= t.x - 5 && x <= t.x + t.w + 5 && y >= t.y - 40 && y <= t.y + t.h + 10);
      if (i >= 0) this.select(i);
    };
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) this.select(n - 1);
      if (e.key === '0') this.select(9);
      if (e.key === 'z' || e.key === 'u') this.doUndo();
    };
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', tap);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', tap);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  select(i) {
    if (this.hold && performance.now() - this.hold.t0 < 900) return; // admiring the solved puzzle
    if (this.sim.over || i >= this.sim.tubes.length) return;
    if (this.sel === null) {
      if (!this.sim.tubes[i].length) return;
      this.sel = i;
      sfx.tap();
      return;
    }
    if (this.sel === i) { this.sel = null; return; }
    const from = this.sel;
    const res = this.sim.pour(from, i);
    this.sel = null;
    if (!res.ok) {
      sfx.bad();
      haptic(20);
      if (this.sim.tubes[i].length) this.sel = i;
      return;
    }
    const before = this.layout();
    this.flying = { from, to: i, color: res.color, n: res.n, t0: performance.now(), L: before };
    sfx.swap();
    if (res.tubeDone) { sfx.match(3); haptic(15); }
    if (res.solved) {
      sfx.win();
      haptic(40);
      this.banner = { text: `Level clear! +${res.reward}`, t0: performance.now() };
      this.flying = null;
      // hold the finished puzzle so you see the last tube close
      this.hold = { tubes: res.solvedTubes, t0: performance.now() };
    }
    this.renderControls();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over) setTimeout(() => this.hooks.onOver?.(this.sim), 800);
  }

  doUndo() {
    if (this.sim.undo().ok) { sfx.swap(); this.sel = null; this.renderControls(); this.hooks.onChange?.(this.sim); }
  }

  renderControls() {
    const s = this.sim;
    this.controls.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center">
      <button class="btn sm ghost" data-a="undo" ${s.history.length ? '' : 'disabled'}>↶ Undo</button>
      <button class="btn sm ghost" data-a="hint" ${s.oxygen > 3 && !s.over ? '' : 'disabled'}>💡 Hint (−3 O₂)</button>
      <button class="btn sm blue" data-a="tube" ${s.extraUsed || s.oxygen <= 5 ? 'disabled' : ''}>🧪 +1 tube (−5 O₂)</button>
      <button class="btn sm ghost" data-a="quit">🏁 Surface</button></div>`;
    for (const b of this.controls.querySelectorAll('[data-a]')) {
      b.onclick = () => {
        if (b.dataset.a === 'undo') this.doUndo();
        else if (b.dataset.a === 'hint') { const h = this.sim.hint(); if (h.ok) { this.hintMove = { a: h.move[0], b: h.move[1], t0: performance.now() }; sfx.special(); this.renderControls(); this.hooks.onChange?.(this.sim); } else sfx.bad(); }
        else if (b.dataset.a === 'tube') { if (this.sim.extraTube().ok) { sfx.special(); this.renderControls(); this.hooks.onChange?.(this.sim); } }
        else this.hooks.onQuit?.();
      };
    }
  }

  loop(now) {
    if (this.destroyed) return;
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  drawBall(x, y, r, c) {
    const ctx = this.ctx;
    const [col, sym] = BALL[c];
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.25, col);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c === 6 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.75)';
    ctx.font = `900 ${r * 0.9}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, x, y + r * 0.05);
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const holding = this.hold && now - this.hold.t0 < (this.reduced ? 300 : 900);
    if (!holding) this.hold = null;
    const tubesNow = holding ? this.hold.tubes : s.tubes;
    const L = holding ? this.layoutFor(tubesNow.length) : this.layout();
    const fly = this.flying && now - this.flying.t0 < (this.reduced ? 1 : 260) ? this.flying : null;
    if (!fly) this.flying = null;
    tubesNow.forEach((tube, i) => {
      const t = L[i];
      const done = tube.length === CAP && tube.every((b) => b === tube[0]);
      // solved: tubes flash green one after another
      if (holding && done) {
        const k = (now - this.hold.t0) / 120 - i;
        if (k > 0 && k < 3) { ctx.fillStyle = `rgba(124,255,178,${0.35 * Math.max(0, 1 - Math.abs(k - 1))})`; roundRect(ctx, t.x - 4, t.y - 4, t.w + 8, t.h + 8, t.w * 0.5); ctx.fill(); }
      }
      // hint: pulse the suggested from/to tubes
      if (this.hintMove && now - this.hintMove.t0 < 2200 && !holding && (i === this.hintMove.a || i === this.hintMove.b)) {
        ctx.strokeStyle = `rgba(255,212,94,${0.5 + 0.5 * Math.sin(now / 120)})`;
        ctx.lineWidth = 3;
        roundRect(ctx, t.x - 5, t.y - 5, t.w + 10, t.h + 10, t.w * 0.5);
        ctx.stroke();
      }
      // glass
      ctx.fillStyle = done ? 'rgba(124,255,178,0.18)' : 'rgba(255,255,255,0.10)';
      roundRect(ctx, t.x, t.y, t.w, t.h, t.w * 0.45);
      ctx.fill();
      ctx.strokeStyle = this.sel === i ? '#ffd45e' : done ? '#7CFFB2' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = this.sel === i ? 4 : 2.5;
      ctx.stroke();
      // balls (bottom up); hide the ones still "in flight"
      const hide = fly && fly.to === i ? fly.n : 0;
      let run = 0;
      if (this.sel === i && !holding) for (let k = tube.length - 1; k >= 0 && tube[k] === tube[tube.length - 1]; k--) run++;
      for (let b = 0; b < tube.length - hide; b++) {
        let bx = t.x + t.w / 2, by = t.y + t.h - t.w * 0.25 - (b + 0.5) * t.ball;
        if (run && b >= tube.length - run) by = t.y - t.ball * (0.6 + (tube.length - 1 - b) * 0.95) + (this.reduced ? 0 : Math.sin(now / 150) * 3);
        this.drawBall(bx, by, t.ball * 0.44, tube[b]);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), t.x + t.w / 2, t.y + t.h + 12);
    });
    if (fly) {
      const p = Math.min(1, (now - fly.t0) / 260);
      const a = L[fly.from], b = L[fly.to];
      const x = a.x + a.w / 2 + (b.x - a.x) * p;
      const y = Math.min(a.y, b.y) - 30 * Math.sin(p * Math.PI) + (b.y - a.y) * p;
      for (let i = 0; i < fly.n; i++) this.drawBall(x, y - i * a.ball * 0.5, a.ball * 0.44, fly.color);
    }
    if (this.banner) {
      const t = (now - this.banner.t0) / 1400;
      if (t > 1) this.banner = null;
      else {
        ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
        ctx.font = '900 24px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,40,0.7)';
        ctx.strokeText(this.banner.text, this.W / 2, 26);
        ctx.fillStyle = '#7CFFB2';
        ctx.fillText(this.banner.text, this.W / 2, 26);
        ctx.globalAlpha = 1;
      }
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Oxygen', value: `🫧 ${sim.oxygen}`, warn: sim.oxygen <= 8 },
    { label: 'Puzzle', value: `#${sim.level}` },
  ];
}

export const HOW = `<div class="tip">🧪 <b>Tap a tube</b>, then tap another to pour. You can pour onto the same colour or into an empty tube (4 balls per tube).</div>
<div class="tip">✅ Fill every tube with a single colour to clear the puzzle – you score points and get oxygen back. Then a harder one appears!</div>
<div class="tip">🫧 Each pour uses 1 oxygen. <b>Undo</b> is free; an <b>extra tube</b> (once per puzzle) costs 5. When the oxygen runs out, the dive ends.</div>
<div class="tip">⚡ Fewer pours = bonus points.</div>`;

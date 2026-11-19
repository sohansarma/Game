// Crab Catch renderer + input.
import { HOLES, GAME_TICKS } from './catch.js';
import { eighthAt } from './catch.js';
import { sfx, haptic } from '../audio.js';

const STEP = 1000 / 60;
const COLS = 3;
const ROWS = HOLES / COLS;
const ICON = { crab: '🦀', gold: '🦀', jelly: '🪼', clock: '⏰' };

export default class CatchView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.popups = [];
    this.splats = [];
    this.destroyed = false;
    this.overSent = false;
    this.lastSecond = null;
    controls.innerHTML = '<div class="small muted center">Tap crabs · avoid 🪼 · ⏰ adds time · keys 1–9, 0, -, = too</div>';
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
    this.W = rect.width;
    this.H = rect.height;
    this.cell = Math.min(this.W / COLS, (this.H - 40) / ROWS);
    this.ox = (this.W - this.cell * COLS) / 2;
    this.oy = 40 + (this.H - 40 - this.cell * ROWS) / 2;
  }

  center(i) {
    return [this.ox + ((i % COLS) + 0.5) * this.cell, this.oy + (Math.floor(i / COLS) + 0.5) * this.cell];
  }

  bind() {
    const down = (e) => {
      e.preventDefault();
      if (!this.sim.started) { if (this.sim.start()) sfx.tap(); return; }
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const c = Math.floor((x - this.ox) / this.cell), row = Math.floor((y - this.oy) / this.cell);
      if (c < 0 || c >= COLS || row < 0 || row >= ROWS) return;
      this.tap(row * COLS + c);
    };
    const keyMap = '1234567890-=';
    const key = (e) => {
      if (document.querySelector('.modal.open')) return;
      if (!this.sim.started && e.key === ' ') { this.sim.start(); return; }
      const i = keyMap.indexOf(e.key);
      if (i >= 0) { if (!this.sim.started) this.sim.start(); else this.tap(i); }
    };
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  tap(i) {
    const res = this.sim.tap(i);
    if (!res.ok) return;
    const [x, y] = this.center(i);
    if (res.what === 'crab' || res.what === 'gold') {
      sfx.match(Math.min(8, this.sim.combo + 1));
      if (res.what === 'gold') { sfx.coin(); haptic(25); } else haptic(8);
      this.popups.push({ x, y, text: `+${res.pts}${res.beat ? ' ♪' : ''}`, color: res.what === 'gold' ? '#ffd23f' : res.beat ? '#9ef0ff' : '#fff', t0: performance.now() });
      if (res.feverStart) { sfx.win(); haptic(40); this.banner = { text: '🔥 FEVER! Double points', t0: performance.now() }; }
      this.splats.push({ x, y, t0: performance.now() });
    } else if (res.what === 'jelly') {
      sfx.lose(); haptic(60);
      this.popups.push({ x, y, text: '−20 ⚡', color: '#ff6fb5', t0: performance.now() });
    } else if (res.what === 'clock') {
      sfx.special();
      this.popups.push({ x, y, text: '+3 s', color: '#7CFFB2', t0: performance.now() });
    } else {
      sfx.bad();
    }
    this.hooks.onChange?.(this.sim);
  }

  loop(now) {
    if (this.destroyed) return;
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.sim.step();
      for (const e of this.sim.events) {
        if (e.kind === 'escape') {
          // an escape breaks the combo: say so
          const [x, y] = this.center(e.hole);
          this.puffs.push({ x, y, t0: performance.now() });
          this.popups.push({ x, y, text: 'Escaped!', color: '#ff7b7b', t0: performance.now() });
          sfx.bad();
          haptic(15);
        }
      }
      // a soft metronome so the beat is felt
      const s0 = this.sim;
      if (s0.started && !s0.over && s0.tick % (eighthAt(s0.tick) * 2) === 0) {
        this.beatT0 = performance.now();
        // an audible click on every beat, a brighter one at the start of each bar
        this.beatN = (this.beatN || 0) + 1;
        sfx.beat(this.beatN % 4 === 1);
      }
    }
    const sec = Math.ceil(this.sim.timeLeft / 60);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      if (this.sim.started && sec <= 5 && sec > 0) sfx.tap();
      this.hooks.onChange?.(this.sim);
    }
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      sfx.win();
      setTimeout(() => this.hooks.onOver?.(this.sim), 700);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim, C = this.cell;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    // timer bar
    const frac = Math.max(0, Math.min(1, s.timeLeft / GAME_TICKS));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(10, 10, this.W - 20, 14);
    ctx.fillStyle = frac < 0.17 ? '#ff5252' : frac < 0.4 ? '#ffb627' : '#4be3a0';
    ctx.fillRect(10, 10, (this.W - 20) * Math.min(1, frac), 14);
    // burrows
    for (let i = 0; i < HOLES; i++) {
      const [x, y] = this.center(i);
      ctx.fillStyle = '#e9c784';
      ctx.beginPath(); ctx.ellipse(x, y + C * 0.18, C * 0.4, C * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a3d1e';
      ctx.beginPath(); ctx.ellipse(x, y + C * 0.18, C * 0.32, C * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      const h = s.holes[i];
      if (h) {
        const age = s.tick - h.born, life = h.until - h.born;
        const rise = Math.min(1, age / 6) * Math.min(1, (life - age) / 6);
        const size = C * 0.55;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - C / 2, y - C, C, C * 1.18);
        ctx.clip();
        ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (h.kind === 'gold') { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 18; }
        ctx.fillText(ICON[h.kind], x, y + C * 0.2 - rise * C * 0.32);
        ctx.shadowBlur = 0;
        if (h.kind === 'gold') {
          ctx.fillStyle = 'rgba(255,210,63,0.35)';
          ctx.beginPath(); ctx.arc(x, y + C * 0.2 - rise * C * 0.32, size * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
    // beat pulse on the sand + fever glow
    if (this.beatT0) {
      const bt = (now - this.beatT0) / 260;
      if (bt < 1) { ctx.strokeStyle = `rgba(255,255,255,${0.18 * (1 - bt)})`; ctx.lineWidth = 6; ctx.strokeRect(3, 3, this.W - 6, this.H - 6); }
    }
    if (s.fever) {
      ctx.strokeStyle = `rgba(255,200,60,${0.5 + 0.3 * Math.sin(now / 90)})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, this.W - 8, this.H - 8);
    }
    this.puffs = (this.puffs || []).filter((p) => now - p.t0 < 450);
    for (const p of this.puffs) {
      const t = (now - p.t0) / 450;
      ctx.fillStyle = `rgba(255,90,90,${0.45 * (1 - t)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, C * (0.2 + t * 0.35), 0, Math.PI * 2); ctx.fill();
    }
    if (this.banner) {
      const bt = (now - this.banner.t0) / 1400;
      if (bt > 1) this.banner = null;
      else {
        ctx.globalAlpha = bt > 0.75 ? (1 - bt) / 0.25 : 1;
        ctx.font = `900 ${C * 0.3}px ui-rounded, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(this.banner.text, this.W / 2, this.H * 0.5);
        ctx.globalAlpha = 1;
      }
    }
    // splats & popups
    this.splats = this.splats.filter((p) => now - p.t0 < 300);
    for (const p of this.splats) {
      const t = (now - p.t0) / 300;
      ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, C * (0.2 + t * 0.4), 0, Math.PI * 2); ctx.stroke();
    }
    this.popups = this.popups.filter((p) => now - p.t0 < 800);
    ctx.textAlign = 'center';
    for (const p of this.popups) {
      const t = (now - p.t0) / 800;
      ctx.globalAlpha = 1 - t;
      ctx.font = `900 ${C * 0.22}px ui-rounded, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.text, p.x, p.y - C * 0.4 - t * C * 0.4);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - C * 0.4 - t * C * 0.4);
    }
    ctx.globalAlpha = 1;
    if (s.combo > 1 && !s.over) {
      ctx.font = `900 ${C * 0.2}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`Combo ×${s.combo}`, this.W / 2, 40);
    }
    if (!s.started) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${C * 0.25}px ui-rounded, system-ui, sans-serif`;
      ctx.fillText('Tap to start the 60 s frenzy!', this.W / 2, this.H / 2);
    }
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Time', value: `⏱️ ${Math.max(0, Math.ceil(sim.timeLeft / 60))}s`, warn: sim.timeLeft < 600 },
    { label: 'Combo', value: `×${sim.combo}` },
  ];
}

export const HOW = `<div class="tip">🦀 Crabs pop out of the sand – <b>tap them</b> before they hide! <b>+10</b> each.</div>
<div class="tip">🔥 Catch 3 in a row to raise your <b>combo</b> (up to ×5). Missing, tapping empty sand or letting a crab escape resets it.</div>
<div class="tip">🎵 Crabs pop on the <b>beat</b> – catch them right on it for a ♪ bonus. Every 12 catches in a row lights a 5-second <b>FEVER</b>: double points, no jellyfish. Listen for the click – tap on it.</div>
<div class="tip">✨ <b>Golden crabs</b> are worth +50 × combo. 🪼 <b>Jellyfish</b> sting: −20! ⏰ <b>Clocks</b> add 3 seconds.</div>
<div class="tip">⏱️ You have 60 seconds and it gets faster towards the end. Go!</div>`;

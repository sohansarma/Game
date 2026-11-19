// Puffer Dash renderer + input (fixed-timestep loop).
import { WORLD_W, WORLD_H, FLOOR, PX, R, PIPE_W } from './puffer.js';
import { sfx, haptic } from '../audio.js';

const STEP = 1000 / 60;

export default class PufferView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.acc = 0;
    this.last = performance.now();
    this.bubbles = Array.from({ length: 18 }, () => ({ x: Math.random() * WORLD_W, y: Math.random() * WORLD_H, r: 0.6 + Math.random() * 1.6, v: 0.15 + Math.random() * 0.3 }));
    this.puff = 0;
    this.floorOff = 0;
    this.destroyed = false;
    this.overSent = false;
    controls.innerHTML = '<div class="small muted center">Tap to swim up · <b>hold</b> to puff up and float · this week\'s course: race your 👻 best</div>';
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
    this.scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    this.ox = (rect.width - WORLD_W * this.scale) / 2;
    this.oy = (rect.height - WORLD_H * this.scale) / 2;
  }

  bind() {
    const flap = (e) => {
      if (e?.type === 'keydown') {
        if (document.querySelector('.modal.open') || ![' ', 'ArrowUp', 'w'].includes(e.key)) return;
        e.preventDefault();
        if (e.repeat) return;
      }
      if (this.sim.over) return;
      this.holding = { tick: this.sim.tick };
      this.sim.flap();
      this.puff = 1;
      sfx.swap();
      haptic(8);
    };
    const down = (e) => { e.preventDefault(); flap(e); };
    // let go: back to normal size
    const up = (e) => {
      if (e?.type === 'keyup' && ![' ', 'ArrowUp', 'w'].includes(e.key)) return;
      this.holding = null;
      if (this.sim.deflate()) sfx.tap();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('keyup', up);
    const resize = () => this.resize();
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', flap);
    window.addEventListener('resize', resize);
    this.unbind = () => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', flap);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keyup', up);
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
      const before = this.sim.score;
      if (this.ghost === undefined) this.ghost = this.loadGhost();
      if (!this.sim.over) this.stepGhost();
      // held for 0.2 s: puff up
      if (this.holding && !this.sim.inflated && this.sim.tick - this.holding.tick >= 12 && this.sim.inflate()) { sfx.special(); haptic(10); }
      this.sim.step();
      for (const e of this.sim.events) {
        if (e === 'pass') sfx.coin();
        if (e === 'squeeze') { sfx.special(); haptic(20); }
        if (e === 'pearl') { sfx.star(2); haptic(15); }
        if (e === 'die') { sfx.boom(); haptic(80); }
      }
      if (this.sim.score !== before || this.sim.events.includes('die')) changed = true;
    }
    if (changed) this.hooks.onChange?.(this.sim);
    if (this.sim.over && !this.overSent) {
      this.overSent = true;
      this.saveGhost();
      setTimeout(() => this.hooks.onOver?.(this.sim), 450);
    }
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  // Your best run on this same seed swims along as a see-through ghost.
  ghostKey() {
    return `tidepop-puffer-ghost:${this.sim.seed}`;
  }
  loadGhost() {
    try {
      const g = JSON.parse(localStorage.getItem(this.ghostKey()) || 'null');
      if (!g || !Array.isArray(g.acts)) return null;
      const sim = new this.sim.constructor(this.sim.seed);
      return { sim, acts: g.acts, i: 0, score: g.score };
    } catch { return null; }
  }
  saveGhost() {
    try {
      const old = JSON.parse(localStorage.getItem(this.ghostKey()) || 'null');
      if (old && old.score >= this.sim.score) return;
      const acts = this.sim.log.filter((a) => a[0] !== 'q');
      if (acts.length > 20000) return;
      localStorage.setItem(this.ghostKey(), JSON.stringify({ score: this.sim.score, acts }));
      // keep only a few ghosts around
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('tidepop-puffer-ghost:'));
      if (keys.length > 8) for (const k of keys.slice(0, keys.length - 8)) if (k !== this.ghostKey()) localStorage.removeItem(k);
    } catch { /* storage full or blocked: no ghost */ }
  }
  stepGhost() {
    const g = this.ghost;
    if (!g || g.sim.over) return;
    if (!g.sim.started) { if (this.sim.started) { g.sim.flap(); g.i = 1; } return; }
    while (g.i < g.acts.length && g.acts[g.i][1] <= g.sim.tick) {
      const [a] = g.acts[g.i++];
      if (a === 'f') g.sim.flap(); else if (a === 'i') g.sim.inflate(); else if (a === 'u') g.sim.deflate();
    }
    g.sim.step();
  }

  draw(now) {
    const ctx = this.ctx, s = this.sim, k = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
    // water
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, '#5fd3f3');
    g.addColorStop(1, '#0a4f8c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    // light rays
    if (!this.reduced) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 4; i++) {
        const x = ((i * 31 + now / 120) % 140) - 20;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 12, 0); ctx.lineTo(x + 40, WORLD_H); ctx.lineTo(x + 22, WORLD_H); ctx.fill();
      }
    }
    // bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.4;
    for (const b of this.bubbles) {
      if (!this.reduced) { b.y -= b.v; if (b.y < -3) { b.y = WORLD_H + 3; b.x = Math.random() * WORLD_W; } }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    // coral pipes
    for (const p of s.pipes) {
      const top = p.gy - p.gap / 2, bottom = p.gy + p.gap / 2;
      if (p.kind === 'squeeze' && !p.scored) {
        ctx.fillStyle = 'rgba(255,212,94,0.18)';
        ctx.fillRect(p.x - 2, top, PIPE_W + 4, p.gap);
      }
      this.coral(p.x, 0, PIPE_W, top, true);
      this.coral(p.x, bottom, PIPE_W, FLOOR - bottom, false);
      if (p.pearl && !p.pearlTaken) {
        const pulse = this.reduced ? 1 : 1 + 0.12 * Math.sin(now / 150);
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(p.x + PIPE_W / 2, p.gy, 2.6 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // sand
    if (!s.over && s.started) this.floorOff = (this.floorOff + s.speed) % 12;
    ctx.fillStyle = '#f2d398';
    ctx.fillRect(0, FLOOR, WORLD_W, WORLD_H - FLOOR);
    ctx.fillStyle = '#d9b26b';
    for (let x = -this.floorOff; x < WORLD_W; x += 12) ctx.fillRect(x, FLOOR + 3, 6, 1.5);
    // ghost of your best run on this seed
    if (this.ghost && !this.ghost.sim.over && this.sim.started) {
      ctx.globalAlpha = 0.3;
      this.fish(PX, this.ghost.sim.y, this.ghost.sim.r, Math.max(-0.5, Math.min(1.1, this.ghost.sim.vy * 0.18)), false);
      ctx.globalAlpha = 1;
    }
    // puffer
    this.puff = Math.max(0, this.puff - 0.06);
    const rot = Math.max(-0.5, Math.min(1.1, s.vy * 0.18));
    this.fish(PX, s.y, s.r * (1 + this.puff * 0.25), rot, s.over);
    // score
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 16px ui-rounded, system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,40,80,0.7)';
    ctx.strokeText(String(s.score), WORLD_W / 2, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(s.score), WORLD_W / 2, 18);
    if (!s.started) {
      ctx.font = '800 8px ui-rounded, system-ui, sans-serif';
      ctx.strokeText('Tap to swim!', WORLD_W / 2, 110);
      ctx.fillText('Tap to swim!', WORLD_W / 2, 110);
    }
    ctx.restore();
  }

  coral(x, y, w, h, flip) {
    const ctx = this.ctx;
    if (h <= 0) return;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ff8a80');
    g.addColorStop(0.5, '#ff6f61');
    g.addColorStop(1, '#d84343');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // lip
    ctx.fillStyle = '#ffab91';
    const ly = flip ? y + h - 5 : y;
    ctx.fillRect(x - 2, ly, w + 4, 5);
    // polyps
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let yy = y + 6; yy < y + h - 6; yy += 9) {
      ctx.beginPath(); ctx.arc(x + 4 + ((yy * 7) % 8), yy, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  fish(x, y, r, rot, dead) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dead ? 2.6 : rot);
    // spikes
    ctx.strokeStyle = '#c79100';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); ctx.stroke();
    }
    // tail
    ctx.fillStyle = '#ffb300';
    ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 1.6, -r * 0.6); ctx.lineTo(-r * 1.6, r * 0.6); ctx.fill();
    // body
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(1, '#ffc928');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c79100';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.25, r * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1b1b2f';
    if (dead) {
      ctx.strokeStyle = '#1b1b2f';
      ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.4); ctx.lineTo(r * 0.5, -r * 0.1); ctx.moveTo(r * 0.5, -r * 0.4); ctx.lineTo(r * 0.2, -r * 0.1); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.22, r * 0.15, 0, Math.PI * 2); ctx.fill();
    }
    // mouth
    ctx.fillStyle = '#e65100';
    ctx.beginPath(); ctx.arc(r * 0.85, r * 0.2, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export function hud(sim) {
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Coral', value: `🪸 ${sim.passed}` },
    { label: 'Pearls', value: `⚪ ${sim.pearls}` },
  ];
}

export const HOW = `<div class="tip">🐡 <b>Tap</b> (or press Space) to make the puffer swim up. Let go to sink.</div>
<div class="tip">🪸 Slip through the gaps in the coral: <b>+10</b> each. Grab glowing <b>pearls</b> for <b>+5</b>.</div>
<div class="tip">⚡ The current speeds up and the gaps get tighter the further you go. Earn 🥉 at 10, 🥈 at 25 and 🥇 at 50 corals!</div>
<div class="tip">🎈 <b>Hold</b> to puff up: you sink slowly and float through tricky stretches – but you're a bigger target. Let go to shrink.</div>
<div class="tip">🌊 After 20 corals some gaps <b>sway</b>; after 40, golden <b>squeeze</b> gaps are worth double. A see-through puffer is your <b>ghost</b> – your best run on the same course – the endless course changes every week, so you can race yourself all week.</div>`;

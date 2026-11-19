// Cube Twist renderer + input: a real 3D cube on a canvas (no libraries).
//  • swipe across a sticker to turn that layer (middle slices too)
//  • drag the space around the cube to look around it
//  • keys: U D L R F B (Shift = counter-clockwise), arrows orbit the view
import { COLORS, FACE_NORMALS, notation } from './cube.js';
import { sfx, haptic } from '../audio.js';
import { load, update } from '../storage.js';

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ease = (t) => 1 - Math.pow(1 - t, 3);

function rotF(v, axis, th) {
  const c = Math.cos(th), s = Math.sin(th);
  const [x, y, z] = v;
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

export default class CubeView {
  constructor({ canvas, controls, sim, hooks, reducedMotion }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.controls = controls;
    this.sim = sim;
    this.hooks = hooks;
    this.reduced = reducedMotion;
    this.yaw = -0.62;
    this.pitch = 0.52;
    this.anim = null;
    this.drag = null;
    this.hits = [];
    this.banner = null;
    this.undoStack = []; // player twists on the current cube
    this.history = []; // the same, in standard notation
    this.t0 = 0; // timer starts on the first twist
    this.stageShown = sim.stage;
    this.destroyed = false;
    this.resize(); // re-measure whenever the layout changes (controls rendering, rotation), not just on window resize
    if (typeof ResizeObserver !== 'undefined') { this.sizeObs = new ResizeObserver(() => { if (!this.destroyed) this.resize(); }); this.sizeObs.observe(this.canvas); }
    this.bind();
    this.renderControls();
    this.showStageBanner();
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

  // ---------------- camera
  get extent() {
    return this.sim.cube.n; // half size in doubled units (2x2: 2, 3x3: 3)
  }
  get scale() {
    return (Math.min(this.W, this.H * 0.9) * 0.255) / this.extent; // fits from any angle
  }
  /** World (doubled units) -> [sx, sy, depth]; bigger depth = closer. */
  proj(p) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
    const D = this.extent * 7;
    const k = D / (D - z2);
    return [this.W / 2 + x1 * this.scale * k, this.H * 0.47 - y2 * this.scale * k, z2];
  }
  /** Direction a world vector faces in view space (for culling/lighting). */
  viewDir(v) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  }

  // ---------------- input
  bind() {
    const c = this.canvas;
    const down = (e) => {
      if (this.sim.over) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      c.setPointerCapture?.(e.pointerId);
      const hit = this.pick(x, y);
      this.drag = { x0: x, y0: y, lx: x, ly: y, hit, done: false, id: e.pointerId };
    };
    const move = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (d.hit) {
        if (!d.done && Math.hypot(x - d.x0, y - d.y0) > Math.max(12, this.scale * 0.35)) {
          d.done = true;
          this.swipeTwist(d.hit, x - d.x0, y - d.y0);
        }
      } else {
        this.yaw += (x - d.lx) * 0.011;
        this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (y - d.ly) * 0.011));
      }
      d.lx = x; d.ly = y;
    };
    const up = (e) => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; };
    const key = (e) => {
      if (document.querySelector('.modal.open') || this.sim.over || e.ctrlKey && e.key.toLowerCase() !== 'z') return;
      const k = e.key.toLowerCase();
      // faces follow what you SEE: R is whatever face is on your right right now
      const cs = (load().settings.cubeKeys || 'letters') === 'cstimer';
      const letters = { r: ['R', 1], l: ['L', 1], u: ['U', 1], d: ['D', 1], f: ['F', 1], b: ['B', 1], m: ['M', 1] };
      const cstimer = { i: ['R', 1], k: ['R', -1], d: ['L', 1], e: ['L', -1], j: ['U', 1], f: ['U', -1], s: ['D', 1], l: ['D', -1], h: ['F', 1], g: ['F', -1], w: ['B', 1], o: ['B', -1], 5: ['M', 1], 6: ['M', -1], 8: ['M', 1], x: ['M', -1],
        u: ['r', 1], m: ['r', -1], v: ['l', 1], r: ['l', -1] }; // wide moves like csTimer
      const hit = (cs ? cstimer : letters)[k];
      if (hit) {
        const p = cs ? hit[1] : e.shiftKey ? -1 : 1;
        const label = hit[0] + (p < 0 ? "'" : '');
        if (hit[0] === 'r' || hit[0] === 'l') {
          // wide = the face plus the middle layer next to it
          const face = this.viewTwist(hit[0].toUpperCase(), p), mid = this.viewTwist('M', hit[0] === 'r' ? -p : p);
          if (face && mid) { this.doTwist(...face, false, label); this.doTwist(...mid, false, ''); e.preventDefault(); }
          return;
        }
        const t = this.viewTwist(hit[0], p);
        if (t) { this.doTwist(...t, false, label); e.preventDefault(); }
        return;
      }
      // y / y': turn the whole cube (just the camera – it isn't a move)
      if ((cs && k === ';') || (!cs && k === 'y' && !e.shiftKey)) { this.yaw -= Math.PI / 2; this.history.push('y'); this.lastWasSingle = false; this.renderControls(); e.preventDefault(); return; }
      if ((cs && k === 'a') || (!cs && k === 'y' && e.shiftKey)) { this.yaw += Math.PI / 2; this.history.push("y'"); this.lastWasSingle = false; this.renderControls(); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') this.yaw -= 0.2;
      else if (e.key === 'ArrowRight') this.yaw += 0.2;
      else if (e.key === 'ArrowUp') this.pitch = Math.min(1.3, this.pitch + 0.2);
      else if (e.key === 'ArrowDown') this.pitch = Math.max(-1.3, this.pitch - 0.2);
      else if (k === 'z' && (e.ctrlKey || e.metaKey)) this.undo();
    };
    const resize = () => this.resize();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    c.style.touchAction = 'none';
    this.unbind = () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }

  /** Front-most sticker under (x, y). */
  pick(x, y) {
    let best = null;
    for (const h of this.hits) {
      if (inPoly(h.poly, x, y) && (!best || h.depth > best.depth)) best = h;
    }
    return best;
  }

  /** Turn the layer that moves the touched sticker most along the swipe. */
  swipeTwist(hit, dx, dy) {
    const P = add(hit.p, hit.n); // sticker centre (world)
    const [px, py] = this.proj(P);
    let bestAxis = -1, bestDot = 0;
    for (let a = 0; a < 3; a++) {
      if (hit.n[a] !== 0) continue; // can't turn around the sticker's own normal
      const e = AXES[a];
      const T = [e[1] * P[2] - e[2] * P[1], e[2] * P[0] - e[0] * P[2], e[0] * P[1] - e[1] * P[0]]; // e × P
      const [qx, qy] = this.proj(add(P, mul(T, 0.05)));
      const tx = qx - px, ty = qy - py, tl = Math.hypot(tx, ty) || 1;
      const dot = (tx * dx + ty * dy) / (tl * Math.hypot(dx, dy));
      if (Math.abs(dot) > Math.abs(bestDot)) { bestDot = dot; bestAxis = a; }
    }
    if (bestAxis < 0 || Math.abs(bestDot) < 0.35) return;
    this.doTwist(bestAxis, hit.p[bestAxis], bestDot > 0 ? 1 : -1);
  }

  /** Face as seen from the camera (R = right of the screen, U = up, F = towards you) -> world twist. */
  viewTwist(face, prime) {
    const L = this.sim.cube.layers, hi = L[L.length - 1], lo = L[0];
    const want = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1], M: [0, -1] }[face];
    if (!want) return null;
    let best = null;
    for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
      const v = [0, 0, 0]; v[a] = s;
      const d = this.viewDir(v)[want[0]] * want[1];
      if (!best || d > best.d) best = { a, s, d };
    }
    if (face === 'M') {
      if (L.indexOf(0) < 0) return null;
      // M turns like L: same direction as the left face
      return [best.a, 0, (best.s > 0 ? -1 : 1) * prime];
    }
    return [best.a, best.s > 0 ? hi : lo, (best.s > 0 ? -1 : 1) * prime];
  }

  pause() { if ((this.t0 || this.inspectT0) && !this.pausedAt) this.pausedAt = performance.now(); }
  resume() {
    if (!this.pausedAt) return;
    const gap = performance.now() - this.pausedAt;
    if (this.t0) this.t0 += gap;
    else if (this.inspectT0) this.inspectT0 += gap; // inspection pauses too
    this.pausedAt = 0;
  }
  /** Stop the clock where it is (Stop = DNF keeps the time visible, not counting). */
  freeze() { if (this.t0) { this.finalTime = (performance.now() - this.t0) / 1000; this.t0 = 0; } }

  /** label: what you pressed (shown in the moves list); '' = part of a wide move, not listed */
  doTwist(axis, layer, dir, isUndo = false, label = null) {
    if (this.sim.over) return;
    if (this.anim) this.anim.t0 = -1e9; // finish the previous turn instantly
    const res = this.sim.twist(axis, layer, dir);
    if (!res.ok) { sfx.bad(); return; }
    haptic(8);
    sfx.swap();
    if (!isUndo) {
      this.undoStack.push([axis, layer, dir]);
      if (label === '') { this.lastWasSingle = false; label = null; return this.afterTwistUi(res, axis, layer, dir); }
      const m = label || notation(this.sim.plan.n, axis, layer, dir);
      // R R shows as R2
      const last = this.history[this.history.length - 1];
      if (last === m && this.lastWasSingle) { this.history[this.history.length - 1] = m[0] + '2'; this.lastWasSingle = false; }
      else { this.history.push(m); this.lastWasSingle = true; }
    }
    return this.afterTwistUi(res, axis, layer, dir);
  }

  afterTwistUi(res, axis, layer, dir) {
    if (!this.t0) {
      this.t0 = performance.now();
      // inspection: over 15 s is +2, over 17 s a DNF (WCA)
      if (this.inspectT0) {
        const ins = (this.t0 - this.inspectT0) / 1000;
        this.penalty = ins > 17 ? 'dnf' : ins > 15 ? '+2' : null;
        this.inspectT0 = 0;
      }
    }
    if (res.solved) {
      // show the finished cube for a moment, then the next scramble
      this.anim = null;
      this.undoStack = [];
      this.lastTime = (performance.now() - (this.t0 || performance.now())) / 1000;
      this.finalTime = this.lastTime;
      this.history = [];
      this.t0 = 0;
      this.banner = { text: res.free ? `Solved in ${this.lastTime.toFixed(2)} s · ${res.moves} moves!` : `Solved in ${res.moves} twists · ${this.lastTime.toFixed(1)} s! +${res.reward}`, t0: performance.now(), good: true };
      sfx.win();
      haptic(40);
      if (!res.free) setTimeout(() => { if (!this.destroyed) this.showStageBanner(); }, 1300);
    } else {
      this.anim = { axis, layer, dir, t0: performance.now(), dur: this.reduced ? 1 : 170 };
    }
    this.renderControls();
    this.hooks.onChange?.(this.sim);
    if (this.sim.over) { sfx.bad(); setTimeout(() => this.hooks.onOver?.(this.sim), 900); }
  }

  undo() {
    const res = this.sim.undo?.();
    if (!res?.ok) return;
    this.undoStack.pop();
    const h = this.history[this.history.length - 1];
    if (h && h.endsWith('2')) { this.history[this.history.length - 1] = h[0]; this.lastWasSingle = true; } else this.history.pop();
    if (this.anim) this.anim.t0 = -1e9;
    const [axis, layer, dir] = res.t;
    this.anim = { axis, layer, dir, t0: performance.now(), dur: this.reduced ? 1 : 150 };
    sfx.swap();
    this.renderControls();
    this.hooks.onChange?.(this.sim);
  }

  showStageBanner() {
    const p = this.sim.plan;
    this.banner = this.sim.free
      ? { text: `Free solve · ${p.n}×${p.n} · timer starts on your first move`, t0: performance.now() }
      : { text: `Cube ${this.sim.stage} of 20 · ${p.n}×${p.n} · ${p.depth}-twist scramble`, t0: performance.now() };
  }

  renderControls() {
    const s = this.sim;
    const hist = this.history.slice(-14).join(' ');
    this.controls.innerHTML = `<div class="col" style="gap:6px;width:100%;align-items:center">
      ${s.free ? (s.daily ? '<div class="cube-scramble small">🔒 The daily scramble is hidden – solve the cube itself, in as few moves as you can (R2 = 1 move).</div>' : `<div class="cube-scramble small"><b>Scramble:</b> ${s.scramble.join(' ')}</div>`) : ''}
      <div class="cube-moves small" aria-label="Your moves">${hist ? `<b>Moves:</b> ${hist}` : '<span class="muted">Your moves appear here in standard notation</span>'}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center">
      <button class="btn sm ghost" data-a="undo" ${this.undoStack.length && !s.over ? '' : 'disabled'}>↶ Undo (free)</button>
      <button class="btn sm ghost" data-a="view">🔄 Reset view</button>
      <button class="btn sm ghost" data-a="keys" title="Keyboard layout">⌨️ ${(load().settings.cubeKeys || 'letters') === 'cstimer' ? 'csTimer keys' : 'Letter keys'}</button>
      <button class="btn sm ghost" data-a="quit">🏁 Stop</button></div>
      <div class="small center muted">Swipe a sticker to turn its layer · drag around the cube to look around</div></div>`;
    for (const b of this.controls.querySelectorAll('[data-a]')) {
      b.onclick = () => {
        if (b.dataset.a === 'undo') this.undo();
        else if (b.dataset.a === 'view') { this.yaw = -0.62; this.pitch = 0.52; sfx.tap(); }
        else if (b.dataset.a === 'keys') {
          update((d) => { d.settings.cubeKeys = (d.settings.cubeKeys || 'letters') === 'cstimer' ? 'letters' : 'cstimer'; });
          sfx.tap();
          this.banner = { text: load().settings.cubeKeys === 'cstimer' ? 'csTimer keys: I/K R, D/E L, J/F U, S/L D, H/G F, W/O B, 5/6 M, ;/A y' : 'Letter keys: R L U D F B M (Shift = prime), Y = y', t0: performance.now() };
          this.renderControls();
        }
        else this.hooks.onQuit?.();
      };
    }
  }

  loop(now) {
    if (this.destroyed) return;
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------- drawing
  draw(now) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const cube = this.sim.cube;
    let a = this.anim, th = 0;
    if (a) {
      const t = Math.min(1, (now - a.t0) / a.dur);
      th = -a.dir * (Math.PI / 2) * (1 - ease(t));
      if (t >= 1) { this.anim = null; a = null; }
    }
    // shadow on the table
    const E = this.extent;
    const [sx, sy] = this.proj([0, -E * 1.25, 0]);
    const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, this.scale * E * 1.5);
    g.addColorStop(0, 'rgba(0,0,30,0.45)');
    g.addColorStop(1, 'rgba(0,0,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(sx, sy, this.scale * E * 1.5, this.scale * E * 0.45, 0, 0, Math.PI * 2); ctx.fill();

    const light = [-0.35, 0.75, 0.55];
    const ln = Math.hypot(...light);
    const items = cube.cubies.map((cb) => {
      const turning = a && cb.p[a.axis] === a.layer;
      const R = (v) => (turning ? rotF(v, a.axis, th) : v);
      return { cb, R, depth: this.proj(R(cb.p))[2] };
    }).sort((x, y) => x.depth - y.depth);
    const hits = [];
    const D = E * 7;
    for (const { cb, R } of items) {
      const c = R(cb.p);
      for (let f = 0; f < 6; f++) {
        const nrm = FACE_NORMALS[f];
        const n = R(nrm);
        const fc = add(c, n);
        // visible if the face points at the camera
        const vn = this.viewDir(n), vc = this.viewDir(fc);
        if (vn[0] * -vc[0] + vn[1] * -vc[1] + vn[2] * (D - vc[2]) <= 0) continue;
        const u = R(AXES[(nrm.findIndex((x) => x !== 0) + 1) % 3]);
        const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
        const quad = (k) => [add(add(fc, mul(u, k)), mul(v, k)), add(add(fc, mul(u, -k)), mul(v, k)), add(add(fc, mul(u, -k)), mul(v, -k)), add(add(fc, mul(u, k)), mul(v, -k))].map((p) => this.proj(p));
        // plastic body
        const body = quad(1);
        ctx.fillStyle = '#121218';
        ctx.beginPath();
        body.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        const st = cb.stickers.find((s) => s.n[0] === nrm[0] && s.n[1] === nrm[1] && s.n[2] === nrm[2]);
        if (!st) continue;
        const sq = quad(0.86);
        const lit = Math.max(0, (this.viewDir(n)[0] * light[0] + this.viewDir(n)[1] * light[1] + this.viewDir(n)[2] * light[2]) / ln);
        roundedPoly(ctx, sq, 0.18);
        ctx.fillStyle = COLORS[st.c];
        ctx.fill();
        // soft shading + a little gloss
        ctx.fillStyle = `rgba(0,0,0,${0.32 * (1 - lit)})`;
        ctx.fill();
        const [p0, , p2] = sq;
        const gl = ctx.createLinearGradient(p0[0], p0[1], p2[0], p2[1]);
        gl.addColorStop(0, `rgba(255,255,255,${0.10 + 0.22 * lit})`);
        gl.addColorStop(0.55, 'rgba(255,255,255,0)');
        ctx.fillStyle = gl;
        ctx.fill();
        if (!a) hits.push({ poly: body.map(([x, y]) => [x, y]), depth: this.proj(fc)[2], p: cb.p.slice(), n: nrm });
        else if (!(a && cb.p[a.axis] === a.layer)) hits.push({ poly: body.map(([x, y]) => [x, y]), depth: this.proj(fc)[2], p: cb.p.slice(), n: nrm });
      }
    }
    // during a turn, keep the turning layer's last known hit areas so fast swipes still land
    this.hits = a ? [...hits, ...(this.lastHits || []).filter((h) => h.p[a.axis] === a.layer)] : hits;
    if (!a) this.lastHits = hits;
    this.drawBanner(now);
    // live solve timer + move counter
    const secs = this.t0 ? ((this.pausedAt || now) - this.t0) / 1000 : this.finalTime || 0;
    if (this.inspectT0 && !this.t0) {
      const left = 15 - (now - this.inspectT0) / 1000;
      ctx.font = '900 30px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = left > 3 ? '#fff' : left > -2 ? '#ffd23f' : '#ff7b7b';
      ctx.fillText(left > 0 ? `Inspect ${Math.ceil(left)}` : left > -2 ? '+2' : 'DNF', this.W / 2, 12);
    }
    ctx.font = '800 15px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`⏱ ${secs.toFixed(1)}s · ${this.sim.cubeMoves} move${this.sim.cubeMoves === 1 ? "" : "s"}`, this.W - 10, this.H - 26);
  }

  drawBanner(now) {
    if (!this.banner) return;
    const ctx = this.ctx;
    const t = (now - this.banner.t0) / 1700;
    if (t > 1) { this.banner = null; return; }
    ctx.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
    ctx.font = '900 20px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,40,0.75)';
    ctx.strokeText(this.banner.text, this.W / 2, 22, this.W - 20);
    ctx.fillStyle = this.banner.good ? '#7CFFB2' : '#fff';
    ctx.fillText(this.banner.text, this.W / 2, 22, this.W - 20);
    ctx.globalAlpha = 1;
  }
}

function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Quad with rounded corners (r = fraction of the edge). */
function roundedPoly(ctx, pts, r) {
  ctx.beginPath();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const a = [p[0] + (prev[0] - p[0]) * r, p[1] + (prev[1] - p[1]) * r];
    const b = [p[0] + (next[0] - p[0]) * r, p[1] + (next[1] - p[1]) * r];
    if (i === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
    ctx.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  ctx.closePath();
}

export function hud(sim) {
  const p = sim.plan;
  if (sim.free) return [{ label: 'Mode', value: sim.daily ? '📅 Daily' : 'Free solve', big: true }, { label: 'Cube', value: `${p.n}×${p.n}` }, { label: 'Moves', value: sim.cubeMoves }];
  return [
    { label: 'Score', value: sim.score.toLocaleString('en-US'), big: true },
    { label: 'Twists', value: `🔄 ${sim.twists}`, warn: sim.twists <= 10 },
    { label: 'Cube', value: `#${sim.stage} · ${p.n}×${p.n}` },
  ];
}

export const HOW = `<div class="tip">🧊 <b>Swipe across a sticker</b> to turn its layer – rows, columns and middle slices. <b>Drag around the cube</b> to look at it from any side.</div>
<div class="tip">🎯 Make every face a single colour. Each cube gives you <b>twists</b>; solve it with twists to spare for a bonus. Leftover twists carry over.</div>
<div class="tip">📈 You start with a 2×2, then move to the 3×3 with ever-longer scrambles. When your twists run out, the run ends.</div>
<div class="tip">⌨️ Keyboard: <b>U D L R F B</b> turn faces (Shift = the other way), arrow keys look around, Ctrl+Z undo.</div>`;

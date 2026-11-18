// Realistic night scenes behind the game, one per vibe. Plain Canvas 2D, no
// libraries. Everything expensive (glows, blurred flakes, clouds, trees) is
// pre-rendered once into sprites; each frame only does drawImage calls.
//
// Techniques: depth layers (parallax, size, speed, blur and opacity all follow
// depth), additive blending ('lighter') for anything that emits light,
// physically-motivated motion (rain ~9 m/s, snow ~1 m/s, embers rise on hot
// air and cool from white → yellow → orange → red), smooth value-noise for
// wind gusts and flame flicker, and real firefly flash patterns.

// ---------------------------------------------------------------- helpers
const TAU = Math.PI * 2;
function sprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  draw(c.getContext('2d'), c.width, c.height);
  return c;
}
/** Smooth 1-D value noise in [-1, 1] (for gusts and flicker). */
function makeNoise(seed = 1) {
  const r = []; let s = seed;
  for (let i = 0; i < 256; i++) { s = (s * 16807) % 2147483647; r.push((s / 2147483647) * 2 - 1); }
  return (x) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return r[i & 255] * (1 - u) + r[(i + 1) & 255] * u;
  };
}
const fbm = (n, x) => n(x) * 0.6 + n(x * 2.1 + 17) * 0.28 + n(x * 4.3 + 41) * 0.12;
const rand = (a, b) => a + Math.random() * (b - a);

/** Soft round glow sprite (radial falloff ~ inverse-square-ish). */
function glowSprite(size, rgb, core = 0.15) {
  return sprite(size, size, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(core, `rgba(${rgb},0.55)`);
    g.addColorStop(0.45, `rgba(${rgb},0.12)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
}

/** A cloud bank made of many soft puffs (pre-rendered once). */
function cloudSprite(w, h, tint, alpha) {
  return sprite(w, h, (c) => {
    for (let i = 0; i < 70; i++) {
      const x = rand(0.05, 0.95) * w, y = h * (0.35 + Math.sin((x / w) * Math.PI) * 0.25 + rand(-0.12, 0.12));
      const r = rand(0.05, 0.16) * w;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${tint},${alpha})`); g.addColorStop(1, `rgba(${tint},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  });
}

/** Pine-forest silhouette strip. */
function treeLine(w, h, color, density, minH, maxH, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return sprite(w, h, (c) => {
    c.fillStyle = color;
    c.fillRect(0, h * 0.92, w, h * 0.08);
    for (let x = -20; x < w + 20; x += density * (0.6 + rnd() * 0.8)) {
      const th = h * (minH + rnd() * (maxH - minH)), tw = th * (0.32 + rnd() * 0.12), base = h * 0.95;
      c.beginPath();
      // stacked tiers like a real spruce
      const tiers = 5 + Math.floor(rnd() * 3);
      c.moveTo(x, base - th);
      for (let k = 1; k <= tiers; k++) {
        const y = base - th + (th * k) / tiers, half = (tw / 2) * (k / tiers) * (1.1 + rnd() * 0.2);
        c.lineTo(x + half, y);
        if (k < tiers) c.lineTo(x + half * 0.45, y - th * 0.02);
      }
      for (let k = tiers; k >= 1; k--) {
        const y = base - th + (th * k) / tiers, half = (tw / 2) * (k / tiers) * (1.1 + rnd() * 0.2);
        if (k < tiers) c.lineTo(x - half * 0.45, y - th * 0.02);
        c.lineTo(x - half, y);
      }
      c.closePath(); c.fill();
    }
  });
}

// ---------------------------------------------------------------- renderer
export class Scene {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.vibe = 'rain';
    this.noise = makeNoise(7);
    this.flash = 0;
    this.t = 0;
  }

  setVibe(v) {
    if (v === this.vibe && this.ready) return;
    this.vibe = v;
    this.build();
  }

  resize(W, H) {
    // backgrounds are soft: render at <= 1.5x for speed on phones
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = W; this.H = H; this.dpr = dpr;
    this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.build();
  }

  /** Lightning: lights the clouds from inside, then flickers. */
  lightning(strength) {
    // real lightning flickers: 2–3 fast return strokes, then a slower decay
    const pulses = 2 + (Math.random() < 0.5 ? 1 : 0);
    this.pulses = Array.from({ length: pulses }, (_, i) => ({ at: this.t + i * rand(0.06, 0.12), s: strength * (i ? rand(0.5, 0.9) : 1) }));
    this.bolt = strength > 0.7 && this.W ? { x: rand(0.15, 0.85) * this.W, t: 0.3, seed: Math.random() * 1000 } : this.bolt;
  }

  build() {
    const { W, H } = this;
    if (!W) return;
    this.ready = true;
    const v = this.vibe;
    const m = Math.min(W, H);
    this.stars = Array.from({ length: Math.round((W * H) / 3500) }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.6, r: Math.random() ** 3 * 1.4 + 0.3, p: Math.random() * TAU, s: rand(0.3, 1.6) }));
    this.starGlow = glowSprite(16, '255,250,235', 0.2);
    // ---- rain: three depth layers of motion-blurred streak sprites
    if (v === 'rain' || v === 'rainfire') {
      this.streaks = [0.35, 0.6, 1].map((z) => sprite(4 + z * 3, 40 + z * 70, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'rgba(200,215,240,0)');
        g.addColorStop(0.7, `rgba(205,220,245,${0.25 + z * 0.35})`);
        g.addColorStop(1, `rgba(230,240,255,${0.4 + z * 0.4})`);
        c.fillStyle = g;
        c.beginPath(); c.ellipse(w / 2, h / 2, (w / 2) * (0.35 + z * 0.3), h / 2, 0, 0, TAU); c.fill();
      }));
      const n = Math.round((W * H) / 2600);
      this.drops = Array.from({ length: n }, () => this.newDrop(true));
      this.splashes = [];
      this.clouds = [cloudSprite(W * 1.6, H * 0.45, '58,66,92', 0.55), cloudSprite(W * 1.6, H * 0.4, '40,46,68', 0.6)];
      this.litClouds = cloudSprite(W * 1.6, H * 0.45, '154,166,200', 0.65);
      this.splashDots = [];
      this.mist = sprite(W, H * 0.35, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(150,170,210,0)'); g.addColorStop(1, 'rgba(150,170,210,0.22)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    }
    // ---- fire: embers with a temperature colour ramp, a pulsing hearth glow
    if (v === 'fire' || v === 'rainfire' || v === 'snow') {
      this.emberGlow = glowSprite(24, '255,170,70', 0.12);
      // blackbody ramp: ~2500 K white-yellow → 1800 K orange → 1200 K red → 1000 K deep red
      this.ramp = [[255, 243, 192], [255, 200, 110], [255, 154, 46], [235, 95, 25], [210, 58, 10], [90, 10, 0]];
      this.hearth = glowSprite(Math.round(m * 1.4), '255,120,40', 0.05);
      this.embers = [];
    }
    // ---- snow: bokeh – near flakes are big and out of focus, far ones sharp
    if (v === 'snow') {
      this.flakeSprites = [0, 1, 2, 3].map((k) => {
        const size = [6, 10, 22, 46][k], blur = [0.0, 0.25, 0.55, 0.8][k];
        return sprite(size, size, (c, w) => {
          const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
          g.addColorStop(0, `rgba(255,255,255,${1 - blur * 0.55})`);
          g.addColorStop(Math.max(0.05, 0.6 - blur * 0.5), `rgba(245,248,255,${0.85 - blur * 0.5})`);
          g.addColorStop(1, 'rgba(240,245,255,0)');
          c.fillStyle = g; c.fillRect(0, 0, w, w);
        });
      });
      const n = Math.round((W * H) / 2200);
      this.flakes = Array.from({ length: n }, () => this.newFlake(true));
      // out-of-focus flakes right in front of the lens: flat core, slightly brighter rim
      this.bokehSprite = sprite(64, 64, (c, w) => {
        const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(245,248,255,0.55)'); g.addColorStop(0.78, 'rgba(245,248,255,0.6)'); g.addColorStop(0.9, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, w);
      });
      this.bokeh = Array.from({ length: 14 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: rand(22, 60), v: rand(140, 230), ph: Math.random() * TAU, a: rand(0.12, 0.22) }));
      this.snowClouds = cloudSprite(W * 1.6, H * 0.5, '150,160,190', 0.35);
      this.drift = sprite(W, H * 0.16, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(230,238,255,0)'); g.addColorStop(0.55, 'rgba(225,233,252,0.55)'); g.addColorStop(1, 'rgba(235,240,255,0.8)');
        c.fillStyle = g; c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += 10) c.lineTo(x, h * 0.45 + Math.sin(x / 70) * h * 0.12 + Math.sin(x / 23) * h * 0.04);
        c.lineTo(w, h); c.closePath(); c.fill();
      });
    }
    // ---- ocean: moon, drifting clouds, layered swells, glitter path
    if (v === 'ocean') {
      const mr = m * 0.075;
      this.moon = sprite(mr * 2.4, mr * 2.4, (c, w) => {
        const cx = w / 2, r = mr;
        const g = c.createRadialGradient(cx - r * 0.3, cx - r * 0.3, r * 0.1, cx, cx, r);
        g.addColorStop(0, '#fbf8ea'); g.addColorStop(0.75, '#e9e4cf'); g.addColorStop(1, '#cfc8ad');
        c.fillStyle = g; c.beginPath(); c.arc(cx, cx, r, 0, TAU); c.fill();
        // maria (the dark "seas" you see on the real moon)
        c.fillStyle = 'rgba(150,145,125,0.22)';
        for (const [dx, dy, rr] of [[-0.25, -0.2, 0.28], [0.15, -0.3, 0.18], [0.2, 0.15, 0.24], [-0.1, 0.3, 0.14], [-0.35, 0.15, 0.12]]) { c.beginPath(); c.arc(cx + dx * r, cx + dy * r, rr * r, 0, TAU); c.fill(); }
      });
      this.moonHalo = glowSprite(Math.round(mr * 9), '190,210,255', 0.08);
      this.oceanClouds = cloudSprite(W * 1.8, H * 0.3, '70,90,125', 0.45);
      this.glitter = Array.from({ length: 160 }, () => ({ u: Math.random(), v: Math.random(), p: Math.random() * TAU, s: rand(1.5, 4) }));
      this.haze = sprite(W, 60, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(120,150,190,0)'); g.addColorStop(0.6, 'rgba(120,150,190,0.2)'); g.addColorStop(1, 'rgba(120,150,190,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    }
    // ---- forest: three parallax tree lines with fog between, fireflies
    if (v === 'forest') {
      this.trees = [
        treeLine(W * 1.3, H * 0.5, '#0f2a22', 26, 0.35, 0.6, 3),
        treeLine(W * 1.3, H * 0.6, '#0a1d17', 34, 0.45, 0.8, 11),
        treeLine(W * 1.3, H * 0.75, '#040c09', 46, 0.6, 1.0, 29),
      ];
      this.fog = sprite(W * 1.5, H * 0.25, (c, w, h) => {
        for (let i = 0; i < 60; i++) { const x = rand(0, w), y = rand(h * 0.3, h * 0.8), r = rand(40, 120); const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(170,200,185,0.12)'); g.addColorStop(1, 'rgba(170,200,185,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
      });
      // real fireflies are yellow-green (~560 nm)
      this.flyGlow = glowSprite(40, '205,255,110', 0.1);
      this.flies = Array.from({ length: 32 }, (_, i) => {
        const female = i % 7 === 0; // ~15% sit low in the grass and answer
        return { x: Math.random() * W, y: (female ? rand(0.86, 0.97) : rand(0.45, 0.88)) * H, z: Math.random(), ph: Math.random() * TAU, next: rand(0, 6), f: 0, dur: rand(0.4, 0.9), female, reply: -1 };
      });
      this.moonSmall = glowSprite(Math.round(m * 0.5), '220,235,210', 0.06);
    }
  }

  newDrop(anywhere) {
    const z = Math.random() ** 1.6; // more far drops than near ones
    const layer = z < 0.4 ? 0 : z < 0.8 ? 1 : 2;
    return { x: rand(-0.1, 1.1) * this.W, y: anywhere ? rand(-0.1, 1) * this.H : rand(-0.3, -0.05) * this.H, z, layer, v: 900 + z * 1500 }; // px/s ~ rain's 9 m/s terminal speed
  }

  newFlake(anywhere) {
    const z = Math.random() ** 1.4;
    const layer = z < 0.45 ? 0 : z < 0.75 ? 1 : z < 0.93 ? 2 : 3;
    return { x: Math.random() * this.W, y: anywhere ? Math.random() * this.H : -50, z, layer, v: 25 + z * 75, ph: Math.random() * TAU, sw: rand(10, 30) };
  }

  /** Draw one frame. opts: { reducedMotion } */
  frame(dt, now, opts = {}) {
    const { ctx, W, H } = this;
    if (!W || !this.ready) return;
    const still = opts.reducedMotion;
    if (!still) this.t += dt;
    const t = this.t;
    ctx.clearRect(0, 0, W, H);
    const v = this.vibe;
    const wind = fbm(this.noise, t * 0.15); // -1..1, slow gusts
    if (v === 'rain' || v === 'rainfire') this.rain(dt, t, wind, still);
    else this.sky(t, v === 'snow' ? 0.3 : 1);
    if (v === 'ocean') this.ocean(t, still);
    if (v === 'forest') this.forest(dt, t, still);
    if (v === 'snow') this.snow(dt, t, wind, still);
    if (v === 'fire' || v === 'rainfire' || v === 'snow') this.fire(dt, t, still, v === 'snow' ? 0.45 : 1);
    for (const p of this.pulses || []) if (!p.done && this.t >= p.at) { this.flash = Math.max(this.flash, p.s); p.done = true; }
    this.flash = Math.max(0, this.flash * Math.exp(-dt * 5)); // ~400 ms decay after each stroke
  }

  sky(t, alpha) {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const tw = (0.55 + 0.45 * Math.sin(t * s.s + s.p)) * alpha; // scintillation
      ctx.globalAlpha = tw * 0.9;
      const r = s.r * 3.2;
      ctx.drawImage(this.starGlow, s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  rain(dt, t, wind, still) {
    const { ctx, W, H } = this;
    // storm clouds drifting; lightning lights them from inside
    const cx = -((t * 6) % (W * 0.6));
    ctx.drawImage(this.clouds[1], cx, -H * 0.05);
    ctx.drawImage(this.clouds[0], cx * 1.6 % (W * 0.6) - W * 0.3, H * 0.02);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.drawImage(this.litClouds, cx, -H * 0.05);
      // the whole sky brightens a touch
      ctx.fillStyle = `rgba(180,190,255,${this.flash * 0.18})`; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.bolt && this.bolt.t > 0) this.drawBolt(dt);
    const slant = 0.1 + wind * 0.12;
    const ang = Math.atan(slant);
    for (const d of this.drops) {
      if (still) continue;
      d.y += d.v * dt;
      d.x += d.v * slant * dt;
      if (d.y > H * (0.82 + d.z * 0.2)) {
        if (d.z > 0.55 && this.splashes.length < 60) {
          this.splashes.push({ x: d.x, y: d.y, t: 0, s: 2 + d.z * 4 });
          // a couple of droplets bounce up from the impact
          for (let k = 0; k < 2 && this.splashDots.length < 150; k++) this.splashDots.push({ x: d.x, y: d.y, vx: rand(-45, 45), vy: rand(-140, -60), t: 0 });
        }
        Object.assign(d, this.newDrop(false));
      }
    }
    // far → near, one rotated frame per layer
    for (let L = 0; L < 3; L++) {
      const sp = this.streaks[L];
      ctx.save();
      ctx.rotate(-ang);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      ctx.globalAlpha = [0.4, 0.6, 0.85][L];
      for (const d of this.drops) {
        if (d.layer !== L) continue;
        // position in the rotated frame
        const rx = d.x * ca - d.y * sa, ry = d.x * sa + d.y * ca;
        ctx.drawImage(sp, rx - sp.width / 2, ry - sp.height);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(215,228,250,0.7)';
    for (const p of this.splashDots) {
      p.t += dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.3);
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }
    this.splashDots = this.splashDots.filter((p) => p.t < 0.3);
    ctx.globalAlpha = 1;
    // little crowns where near drops land
    ctx.strokeStyle = 'rgba(210,225,250,0.55)';
    ctx.lineWidth = 1;
    for (const s of this.splashes) {
      s.t += dt;
      const k = s.t / 0.28;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.s * (0.5 + k * 1.6), s.s * 0.35 * (0.5 + k), 0, Math.PI, TAU); ctx.stroke();
    }
    this.splashes = this.splashes.filter((s) => s.t < 0.28);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.mist, 0, H * 0.65);
  }

  drawBolt(dt) {
    const { ctx, H } = this;
    const b = this.bolt;
    b.t -= dt;
    let s = b.seed;
    const rnd = () => { s = (s * 16807 + 7) % 2147483647; return s / 2147483647; };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, b.t / 0.25) * 0.8;
    ctx.strokeStyle = 'rgba(225,235,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let x = b.x, y = H * 0.1;
    ctx.moveTo(x, y);
    while (y < H * 0.45) { x += (rnd() - 0.5) * 26; y += 8 + rnd() * 16; ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.restore();
  }

  fire(dt, t, still, scale) {
    const { ctx, W, H } = this;
    // hearth glow just below the screen, flickering with layered noise
    // flicker: noise octaves (~0.7, 2.3, 7 Hz) clamped to 0.75–1, plus the odd pop
    let f = 0.75 + 0.25 * (0.5 + 0.5 * (this.noise(t * 0.7 + 100) * 0.6 + this.noise(t * 2.3 + 200) * 0.3 + this.noise(t * 7 + 300) * 0.1));
    if (!still && Math.random() < dt * 0.25 * scale) {
      f = 1.15;
      for (let k = 0; k < 10; k++) this.embers.push({ x: W * rand(0.4, 0.6), y: H + 4, vx: rand(-80, 80), vy: rand(-320, -180), life: 0, max: rand(0.5, 1.2), r: rand(0.6, 1.2), ph: Math.random() * 100, spark: true });
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.33 * f * scale;
    const hs = this.hearth.width;
    ctx.drawImage(this.hearth, W / 2 - hs / 2, H - hs * 0.32, hs, hs * 0.75);
    // embers: spawn at the bottom, rise on hot air, cool as they climb
    if (!still && this.embers.length < 70 * scale && Math.random() < dt * 40 * scale) {
      this.embers.push({ x: W * rand(0.25, 0.75), y: H + 6, vx: rand(-15, 15), vy: rand(-140, -60), life: 0, max: rand(1.8, 4.2), r: rand(0.8, 2.2), ph: Math.random() * 100 });
    }
    for (const e of this.embers) {
      if (!still) {
        e.life += dt;
        e.vx += fbm(this.noise, e.ph + t * 1.7) * 90 * dt; // turbulence
        e.vy -= (e.spark ? 0 : 25) * dt * (1 - e.life / e.max); // hot air keeps lifting while it's hot
        e.vx *= 0.985; e.vy *= 0.985; // drag
        e.x += e.vx * dt; e.y += e.vy * dt;
      }
      const k = e.life / e.max; // 0 hot … 1 cold
      // temperature ramp: white-yellow → orange → deep red → gone
      const col = this.ramp[Math.min(this.ramp.length - 1, Math.floor(k * this.ramp.length))];
      const twinkle = 0.7 + 0.3 * Math.sin(t * 25 + e.ph);
      ctx.globalAlpha = Math.max(0, 1 - k) * twinkle * scale;
      const r = e.r * (1 - k * 0.5) * 5;
      ctx.drawImage(this.emberGlow, e.x - r, e.y - r, r * 2, r * 2);
      ctx.fillStyle = `rgb(${col})`;
      ctx.fillRect(e.x - e.r / 2, e.y - e.r / 2, e.r, e.r);
    }
    this.embers = this.embers.filter((e) => e.life < e.max && e.y > -10);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  snow(dt, t, wind, still) {
    const { ctx, W, H } = this;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.snowClouds, -((t * 4) % (W * 0.6)), -H * 0.08);
    ctx.globalAlpha = 1;
    // far → near so the big blurry flakes pass in front
    this.flakes.sort((a, b) => a.z - b.z);
    for (const f of this.flakes) {
      if (!still) {
        f.y += f.v * dt;
        f.x += (Math.sin(t * 0.9 + f.ph) * f.sw + wind * 60 * (0.4 + f.z)) * dt; // sway + gusts
        if (f.y > H + 30) Object.assign(f, this.newFlake(false));
        if (f.x > W + 30) f.x = -30; else if (f.x < -30) f.x = W + 30;
      }
      const sp = this.flakeSprites[f.layer];
      const s = sp.width * (0.7 + f.z * 0.6);
      ctx.globalAlpha = f.layer === 3 ? 0.45 : 0.5 + f.z * 0.5;
      ctx.drawImage(sp, f.x - s / 2, f.y - s / 2, s, s);
    }
    for (const b of this.bokeh) {
      if (!still) {
        b.y += b.v * dt;
        b.x += (wind * 160 + Math.sin(t * 0.8 + b.ph) * 30) * dt;
        if (b.y > H + 60) { b.y = -60; b.x = Math.random() * W; }
        if (b.x > W + 60) b.x = -60; else if (b.x < -60) b.x = W + 60;
      }
      ctx.globalAlpha = b.a;
      ctx.drawImage(this.bokehSprite, b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.drift, 0, H * 0.86);
  }

  ocean(t, still) {
    const { ctx, W, H } = this;
    const mx = W * 0.7, my = H * 0.17;
    ctx.globalCompositeOperation = 'lighter';
    const hs = this.moonHalo.width;
    ctx.drawImage(this.moonHalo, mx - hs / 2, my - hs / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.moon, mx - this.moon.width / 2, my - this.moon.height / 2);
    // thin clouds drifting across the moon
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this.oceanClouds, ((t * 7) % (W * 1.8)) - W * 0.9, H * 0.06);
    ctx.globalAlpha = 1;
    const horizon = H * 0.56;
    // horizon haze
    ctx.drawImage(this.haze, 0, horizon - 36);
    // swells: farther = flatter, darker, slower (perspective)
    for (let k = 0; k < 6; k++) {
      const depth = k / 5; // 0 far … 1 near
      const base = horizon + Math.pow(depth, 1.6) * (H - horizon) * 0.95;
      const amp = 2 + depth * 14, len = 60 + depth * 220, sp = 0.25 + depth * 0.6;
      ctx.fillStyle = `rgb(${8 + depth * 10},${30 + depth * 24},${52 + depth * 34})`;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 10; x += 10) {
        const ph = x / len + (still ? 0 : t * sp) + k * 1.7;
        // sharper crests, flatter troughs – like a Gerstner/trochoid wave
        ctx.lineTo(x, base - amp * (Math.sin(ph) + 0.35 * Math.sin(ph * 2 + 1.2)));
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    // the moon's glitter path: sparkles that flash on and off as swells tilt
    ctx.globalCompositeOperation = 'lighter';
    for (const g of this.glitter) {
      const d = g.v; // 0 horizon … 1 near
      const y = horizon + Math.pow(d, 1.5) * (H - horizon);
      const spread = 8 + d * W * 0.22;
      const x = mx + (g.u - 0.5) * 2 * spread * (0.6 + 0.4 * Math.sin(t * 0.7 + g.p));
      // a glint only flashes where the local swell slope tilts toward you
      const slope = Math.cos(x / (60 + d * 220) + t * (0.25 + d * 0.6) + g.p);
      const gauss = Math.exp(-(((x - mx) / spread) ** 2) * 1.5);
      const on = Math.max(0, slope) ** 5 * gauss * (0.6 + 0.4 * Math.sin(t * g.s + g.p));
      if (on < 0.05) continue;
      ctx.globalAlpha = on * (0.9 - d * 0.3);
      const w = 2 + d * 8;
      ctx.fillStyle = 'rgb(245,245,225)';
      ctx.fillRect(x - w / 2, y, w, 1 + d * 1.5);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  forest(dt, t, still) {
    const { ctx, W, H } = this;
    // a small moon low in the trees
    ctx.globalCompositeOperation = 'lighter';
    const ms = this.moonSmall.width;
    ctx.drawImage(this.moonSmall, W * 0.25 - ms / 2, H * 0.2 - ms / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#e9efdc';
    ctx.beginPath(); ctx.arc(W * 0.25, H * 0.2, Math.min(W, H) * 0.035, 0, TAU); ctx.fill();
    // parallax layers with fog drifting between them
    const layers = [[this.trees[0], H * 0.38, 3], [this.trees[1], H * 0.42, 6], [this.trees[2], H * 0.3, 11]];
    layers.forEach(([img, y, speed], i) => {
      const x = -((t * speed) % (img.width - W));
      ctx.drawImage(img, x, y);
      if (i < 2) { ctx.globalAlpha = 0.9; ctx.drawImage(this.fog, -((t * (speed + 4)) % (this.fog.width - W)), y + img.height * 0.55); ctx.globalAlpha = 1; }
    });
    // fireflies (Photinus pyralis): males flash every ~5–7 s and lift in a "J" while lit;
    // females answer from the grass 1–2 s later. Dark in between – no constant glow.
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flies) {
      if (!still) {
        if (!f.female) {
          f.x += Math.sin(t * 0.3 + f.ph) * 10 * dt;
          f.y += (Math.cos(t * 0.23 + f.ph * 1.3) * 7 - (f.f > 0 ? 28 : 0)) * dt; // the J-lift
          if (f.y < H * 0.4) f.y = H * 0.4;
          f.next -= dt;
          if (f.next <= 0) {
            f.f = f.dur; f.next = rand(5, 7);
            // a nearby female may answer
            for (const q of this.flies) if (q.female && q.reply < 0 && Math.abs(q.x - f.x) < W * 0.3 && Math.random() < 0.5) q.reply = rand(1, 2);
          }
        } else if (f.reply >= 0) {
          f.reply -= dt;
          if (f.reply < 0) f.f = 0.5;
        }
        f.f = Math.max(0, f.f - dt);
      }
      const dur = f.female ? 0.5 : f.dur;
      const k = 1 - f.f / dur; // 0 → 1 through the flash
      // ~100 ms rise, hold, ~300 ms decay
      let b = f.f <= 0 ? 0 : k < 0.15 ? k / 0.15 : k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      if (still) b = f.female ? 0 : 0.5;
      if (b < 0.02) continue;
      const sz = (f.female ? 14 : 18) + f.z * 26;
      ctx.globalAlpha = b * (0.55 + f.z * 0.45);
      ctx.drawImage(this.flyGlow, f.x - sz / 2, f.y - sz / 2, sz, sz);
      ctx.globalAlpha = b;
      ctx.fillStyle = '#f4ffb0'; // hot core
      ctx.fillRect(f.x - 1, f.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

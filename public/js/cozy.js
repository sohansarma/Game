// Cozy mode – an optional night-time ambience for the whole game:
//  • soundscapes, synthesised live (no audio files): rain, fireplace,
//    night ocean, or rain + fireplace; distant thunder with rain
//  • behind the game: falling rain or a starry night sky, a soft sky glow
//    a moment before each roll of thunder (none with reduced motion)
//  • over every screen: a warm lamp glow and soft vignette (flickering with
//    the fire) and raindrops trickling down the window glass – never blocking taps
//  • game sounds get quieter and the music turns into a slow night lullaby
//  • a sleep timer fades everything out and dims the screen
//
// settings.cozy: 'off' | 'on' | 'night' (on automatically 9pm–6am)
// settings.cozySound (the "vibe"): 'rain' | 'fire' | 'rainfire' | 'ocean' | 'snow' | 'forest'
// settings.cozyVol 0..1 · thunder bool · cozyWindow bool · sleepTimer minutes (0 = off)

import { onAudioReady, setNightAudio } from './audio.js';
import { Scene } from './scenes.js';

let cfg = { cozy: 'off', cozySound: 'rain', cozyVol: 0.6, thunder: true, cozyWindow: true, sleepTimer: 0, reducedMotion: false };
let active = false;
let audio = null; // { ctx, bus, nodes, timers }
let thunderTimer = null;
let sleepTimer = null;
let sleptAt = 0;
let nightCheck = null;
const listeners = new Set();
const sleepFns = new Set();

export const isNightTime = (d = new Date()) => d.getHours() >= 21 || d.getHours() < 6;
/** Each vibe re-themes the whole platform: sound, sky, particles, palette, Pip. */
export const VIBES = [
  { id: 'rain', icon: '🌧️', name: 'Rainy night', desc: 'Soft rain, distant thunder, drops on the window', pip: 'snoozing to the sound of the rain' },
  { id: 'fire', icon: '🔥', name: 'Fireside', desc: 'Crackling logs, floating embers, warm amber light', pip: 'toasting marshmallows by the fire' },
  { id: 'rainfire', icon: '⛈️', name: 'Storm & fire', desc: 'A storm outside, a crackling fire inside', pip: 'curled up by the fire while it storms' },
  { id: 'ocean', icon: '🌊', name: 'Moonlit ocean', desc: 'Slow waves, a big moon, silver light', pip: 'watching the moon on the water' },
  { id: 'snow', icon: '❄️', name: 'Snowy cabin', desc: 'Falling snow, howling wind, a little fire', pip: 'wrapped in a blanket, watching the snow' },
  { id: 'forest', icon: '🌲', name: 'Forest night', desc: 'Crickets, rustling leaves, fireflies, an owl', pip: 'counting fireflies' },
];
export const VIBE = Object.fromEntries(VIBES.map((v) => [v.id, v]));
const raining = () => cfg.cozySound === 'rain' || cfg.cozySound === 'rainfire';
const fireOn = () => ['fire', 'rainfire', 'snow'].includes(cfg.cozySound);

export function cozyActive() {
  return active;
}
export function cozySleeping() {
  return sleptAt > 0;
}
export function cozySound() {
  return cfg.cozySound;
}
export function onCozyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onSleep(fn) {
  sleepFns.add(fn);
}

/** Apply settings (call on start and whenever they change). */
export function configureCozy(settings) {
  const prev = cfg;
  cfg = { ...cfg, ...settings };
  if (prev.sleepTimer !== cfg.sleepTimer) sleptAt = 0;
  const want = cfg.cozy === 'on' || (cfg.cozy === 'night' && isNightTime());
  clearInterval(nightCheck);
  if (cfg.cozy === 'night') nightCheck = setInterval(() => configureCozy({}), 60000);
  if (want && !active) start();
  else if (!want && active) stop();
  else if (active) {
    if (prev.cozySound !== cfg.cozySound) { stopAudio(); onAudioReady((ctx, out) => { if (active) startAudio(ctx, out); }); }
    setVolume();
    armSleep();
    scheduleThunder();
    syncVisuals();
    emit();
  }
}

function emit() {
  document.body.classList.toggle('cozy', active);
  document.body.classList.toggle('cozy-fire', active && fireOn());
  if (active) document.body.dataset.vibe = cfg.cozySound;
  else delete document.body.dataset.vibe;
  document.body.classList.toggle('cozy-sleepy', active && sleptAt > 0);
  for (const fn of listeners) { try { fn(active); } catch { /* ignore */ } }
}

function start() {
  active = true;
  sleptAt = 0;
  setNightAudio(true);
  startVisuals();
  onAudioReady((ctx, out) => { if (active) startAudio(ctx, out); });
  armSleep();
  emit();
}

function stop() {
  active = false;
  sleptAt = 0;
  setNightAudio(false);
  clearTimeout(thunderTimer);
  clearTimeout(sleepTimer);
  stopAudio();
  stopVisuals();
  emit();
}

// ---------------------------------------------------------------- sound
function noiseBuffer(ctx, seconds, color) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') { // Paul Kellet's economy pink filter
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      } else if (color === 'white') d[i] = w * 0.5;
      else { // brown
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
  }
  return buf;
}

/** A looping noise layer: source -> filters -> gain -> bus. */
function layer(A, buf, filters, gain) {
  const { ctx } = A;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  let node = src;
  for (const [type, freq, q] of filters) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    node.connect(f); node = f;
    A.nodes.push(f);
  }
  const g = ctx.createGain();
  g.gain.value = gain;
  node.connect(g);
  g.connect(A.bus);
  src.start();
  A.nodes.push(src, g);
  return g;
}

/** Short filtered noise burst (raindrop on glass, fire crackle). */
function burst(A, { at, freq, q, peak, dur, pan = 0 }) {
  const { ctx } = A;
  const src = ctx.createBufferSource();
  src.buffer = A.click;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  src.connect(bp); bp.connect(g);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(A.bus); }
  else g.connect(A.bus);
  src.start(at); src.stop(at + dur + 0.02);
}

function startAudio(ctx, out) {
  if (audio) return;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  const A = { ctx, bus, nodes: [bus], timers: [], click: noiseBuffer(ctx, 0.08, 'white') };
  audio = A;
  const sound = cfg.cozySound;
  if (raining()) {
    // the hiss of rain, swelling slowly like gusts of wind
    const hiss = layer(A, noiseBuffer(ctx, 4, 'pink'), [['highpass', 500], ['lowpass', 7000]], sound === 'rainfire' ? 0.42 : 0.55);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const amt = ctx.createGain(); amt.gain.value = 0.16;
    lfo.connect(amt); amt.connect(hiss.gain); lfo.start();
    A.nodes.push(lfo, amt);
    layer(A, noiseBuffer(ctx, 5, 'brown'), [['lowpass', 900]], 0.65); // rain on the roof
    const drops = () => {
      if (audio !== A) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) burst(A, { at: t + Math.random() * 0.25, freq: 2500 + Math.random() * 4000, q: 6, peak: 0.2 + Math.random() * 0.3, dur: 0.05, pan: Math.random() * 1.6 - 0.8 });
      A.timers.push(setTimeout(drops, 120 + Math.random() * 160));
    };
    drops();
  }
  if (sound === 'snow') {
    // wind around the cabin: noise through a band-pass whose pitch drifts slowly
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx, 6, 'pink');
    windSrc.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 3.5;
    const wg = ctx.createGain(); wg.gain.value = 0.9;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lamt = ctx.createGain(); lamt.gain.value = 260;
    lfo.connect(lamt); lamt.connect(bp.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const l2 = ctx.createGain(); l2.gain.value = 0.45;
    lfo2.connect(l2); l2.connect(wg.gain);
    windSrc.connect(bp); bp.connect(wg); wg.connect(A.bus);
    windSrc.start(); lfo.start(); lfo2.start();
    A.nodes.push(windSrc, bp, wg, lfo, lamt, lfo2, l2);
  }
  if (sound === 'forest') {
    // leaves in a light breeze
    const leaves = layer(A, noiseBuffer(ctx, 5, 'pink'), [['highpass', 1800], ['lowpass', 6000]], 0.1);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const amt = ctx.createGain(); amt.gain.value = 0.07;
    lfo.connect(amt); amt.connect(leaves.gain); lfo.start();
    A.nodes.push(lfo, amt);
    layer(A, noiseBuffer(ctx, 5, 'brown'), [['lowpass', 260]], 0.25); // the night air
    // crickets: quick trains of high chirps from a few directions
    const cricket = (pan, pitch) => {
      const go = () => {
        if (audio !== A) return;
        const t = ctx.currentTime;
        for (let k = 0; k < 3; k++) {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = pitch;
          const g = ctx.createGain();
          const at = t + k * 0.055;
          g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.05, at + 0.008); g.gain.linearRampToValueAtTime(0, at + 0.04);
          let node = g;
          if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
          o.connect(g); node.connect(A.bus);
          o.start(at); o.stop(at + 0.05);
        }
        A.timers.push(setTimeout(go, 600 + Math.random() * 900));
      };
      A.timers.push(setTimeout(go, Math.random() * 800));
    };
    cricket(-0.6, 4300); cricket(0.5, 4700); cricket(0.1, 3900);
    // a distant owl now and then: "hoo … hoo-hoo"
    const owl = () => {
      if (audio !== A) return;
      const t = ctx.currentTime;
      [[0, 0.5], [0.9, 0.25], [1.25, 0.45]].forEach(([d, len]) => {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(410, t + d); o.frequency.linearRampToValueAtTime(370, t + d + len);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.09, t + d + 0.06); g.gain.setTargetAtTime(0, t + d + len * 0.7, 0.08);
        o.connect(g); g.connect(A.bus); o.start(t + d); o.stop(t + d + len + 0.4);
      });
      A.timers.push(setTimeout(owl, 30000 + Math.random() * 40000));
    };
    A.timers.push(setTimeout(owl, 8000 + Math.random() * 10000));
  }
  if (fireOn()) {
    // the low roar of burning logs + crackles and the odd pop (softer in the snowy cabin)
    layer(A, noiseBuffer(ctx, 5, 'brown'), [['lowpass', 320]], sound === 'snow' ? 0.45 : 0.9);
    layer(A, noiseBuffer(ctx, 3, 'pink'), [['bandpass', 1200, 0.7]], 0.05);
    const crackle = () => {
      if (audio !== A) return;
      const t = ctx.currentTime;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) burst(A, { at: t + Math.random() * 0.12, freq: 1500 + Math.random() * 3500, q: 2, peak: 0.25 + Math.random() * 0.45, dur: 0.02 + Math.random() * 0.03, pan: Math.random() * 0.8 - 0.4 });
      if (Math.random() < 0.06) burst(A, { at: t + 0.05, freq: 700, q: 1, peak: 0.9, dur: 0.12, pan: Math.random() * 0.6 - 0.3 }); // a log pops
      A.timers.push(setTimeout(crackle, 60 + Math.random() * 380));
    };
    crackle();
  }
  if (sound === 'ocean') {
    // slow waves: rumble and foam rising and falling together (~11 s per wave)
    const rumble = layer(A, noiseBuffer(ctx, 6, 'brown'), [['lowpass', 520]], 0.55);
    const foam = layer(A, noiseBuffer(ctx, 4, 'pink'), [['highpass', 900], ['lowpass', 5000]], 0.18);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const a1 = ctx.createGain(); a1.gain.value = 0.5;
    const a2 = ctx.createGain(); a2.gain.value = 0.17;
    lfo.connect(a1); a1.connect(rumble.gain);
    lfo.connect(a2); a2.connect(foam.gain);
    lfo.start();
    A.nodes.push(lfo, a1, a2);
  }
  setVolume();
  scheduleThunder(true);
}

function stopAudio() {
  if (!audio) return;
  const { ctx, bus, nodes, timers } = audio;
  for (const t of timers) clearTimeout(t);
  bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => { for (const n of nodes) { try { n.stop?.(); n.disconnect(); } catch { /* ignore */ } } }, 2000);
  audio = null;
}

function setVolume() {
  if (!audio) return;
  const v = sleptAt ? 0 : Math.max(0, Math.min(1, cfg.cozyVol));
  audio.bus.gain.setTargetAtTime(v * 0.9, audio.ctx.currentTime, sleptAt ? 8 : 0.8);
}

function scheduleThunder(first = false) {
  clearTimeout(thunderTimer);
  if (!active || !cfg.thunder || !raining()) return;
  const wait = first ? 6000 + Math.random() * 8000 : 25000 + Math.random() * 45000;
  thunderTimer = setTimeout(() => {
    if (!active || sleptAt) return;
    const near = Math.random();
    lightning(near);
    // light first, sound a moment later – like a real storm
    setTimeout(() => thunder(near), 500 + (1 - near) * 2200);
    scheduleThunder();
  }, wait);
}

function thunder(near) {
  if (!audio || !active) return;
  const { ctx } = audio;
  const t = ctx.currentTime;
  const len = 5 + near * 3;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, len, 'brown');
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(120 + near * 260, t);
  lp.frequency.exponentialRampToValueAtTime(60, t + len);
  const g = ctx.createGain();
  const peak = 0.8 + near * 0.9; // the bus applies the volume
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.25 + (1 - near) * 0.9);
  g.gain.setTargetAtTime(peak * 0.55, t + 1.2, 0.5);
  g.gain.setTargetAtTime(peak * 0.8, t + 1.9, 0.3);
  g.gain.setTargetAtTime(0.0001, t + 2.6, len / 4);
  src.connect(lp); lp.connect(g); g.connect(audio.bus);
  src.start(t); src.stop(t + len);
}

// ---------------------------------------------------------------- sleep timer
function armSleep() {
  clearTimeout(sleepTimer);
  if (!active || !cfg.sleepTimer || sleptAt) return;
  sleepTimer = setTimeout(() => {
    sleptAt = Date.now();
    setVolume();
    emit();
    for (const fn of sleepFns) { try { fn(); } catch { /* ignore */ } }
  }, cfg.sleepTimer * 60000);
}
/** Wake up after the sleep timer (restarts the timer). */
export function wakeCozy() {
  if (!sleptAt) return;
  sleptAt = 0;
  setVolume();
  armSleep();
  emit();
}

// ---------------------------------------------------------------- visuals
// Behind the game (#bg): a realistic scene per vibe (scenes.js).
// Over the game (#cozy-over, pointer-events: none): lamp glow, vignette and,
// when it rains, water beads on the "window" that refract the scene behind.
let scene = null, sceneEl = null, glass = null, over = null, raf = null, W = 0, H = 0;
let beads = [];

function startVisuals() {
  const bg = document.getElementById('bg');
  if (!bg || scene) return;
  sceneEl = document.createElement('canvas');
  sceneEl.id = 'cozy-rain';
  sceneEl.setAttribute('aria-hidden', 'true');
  bg.appendChild(sceneEl);
  scene = new Scene(sceneEl);
  scene.vibe = cfg.cozySound;
  over = document.createElement('div');
  over.id = 'cozy-over';
  over.setAttribute('aria-hidden', 'true');
  over.innerHTML = '<div class="cozy-lamp"></div><div class="cozy-vignette"></div>';
  document.body.appendChild(over);
  const g = document.createElement('canvas');
  g.id = 'cozy-glass';
  over.appendChild(g);
  glass = { el: g, ctx: g.getContext('2d') };
  window.addEventListener('resize', size);
  size();
  let last = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; } // pause in the background
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    scene.frame(dt, now, { reducedMotion: cfg.reducedMotion });
    drawGlass(dt);
    if (fireOn() && !cfg.reducedMotion) {
      // the lamp breathes with the fire
      const f = 0.82 + 0.1 * Math.sin(now / 410) + 0.06 * Math.sin(now / 133) + 0.04 * Math.sin(now / 71);
      over.style.setProperty('--flicker', f.toFixed(3));
    } else over.style.setProperty('--flicker', '0.85');
  };
  raf = requestAnimationFrame(frame);
}

function size() {
  if (!scene) return;
  W = window.innerWidth; H = window.innerHeight;
  scene.vibe = cfg.cozySound;
  scene.resize(W, H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  glass.el.width = Math.round(W * dpr); glass.el.height = Math.round(H * dpr);
  glass.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  beads = [];
}

function syncVisuals() {
  if (scene) { scene.setVibe(cfg.cozySound); beads = []; }
}

function stopVisuals() {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', size);
  sceneEl?.remove();
  over?.remove();
  scene = sceneEl = glass = over = null;
}

/**
 * Water beads on the window. Each one is a tiny lens: it shows the scene
 * behind it flipped upside-down and shrunk, with a dark lower rim and a
 * bright highlight. Beads sit, grow, then slide down (stick–slip), merging
 * with drops they hit and leaving a trail of tiny droplets.
 */
function drawGlass(dt) {
  const c = glass.ctx;
  c.clearRect(0, 0, W, H);
  if (!raining() || !cfg.cozyWindow || cfg.reducedMotion) return;
  const max = Math.round((W * H) / 14000);
  if (beads.length < max && Math.random() < dt * 4) beads.push({ x: Math.random() * W, y: Math.random() * H * 0.92, r: 1.2 + Math.random() * 2.4, v: 0, stall: 0, trail: [] });
  const src = sceneEl, sx = src.width / W, sy = src.height / H;
  for (const b of beads) {
    // grow by catching new drizzle; heavy beads slide in fits and starts
    if (b.r < 7 && Math.random() < dt * 0.25) b.r += 0.4;
    if (b.r > 3.2) {
      if (b.stall > 0) b.stall -= dt;
      else {
        b.v = Math.min(140, b.v + 220 * dt);
        if (Math.random() < dt * 1.5) { b.stall = Math.random() * 0.6; b.v = 0; }
      }
      b.y += b.v * dt;
      b.x += Math.sin(b.y / 19) * 0.25;
      if (!b.trail.length || b.y - b.trail[b.trail.length - 1][1] > 7) b.trail.push([b.x, b.y, b.r * (0.18 + Math.random() * 0.12)]);
      if (b.trail.length > 24) b.trail.shift();
    }
    // merge (area conserved)
    for (const o of beads) {
      if (o === b || o.dead || b.dead) continue;
      if (Math.abs(o.x - b.x) < b.r + o.r && Math.abs(o.y - b.y) < b.r + o.r && Math.hypot(o.x - b.x, o.y - b.y) < (b.r + o.r) * 0.8) {
        const big = b.r >= o.r ? b : o, small = big === b ? o : b;
        big.r = Math.min(9, Math.sqrt(big.r * big.r + small.r * small.r));
        small.dead = true;
      }
    }
  }
  beads = beads.filter((b) => !b.dead && b.y < H + 12);
  for (const b of beads) {
    for (const [x, y, r] of b.trail) {
      c.fillStyle = 'rgba(220,232,255,0.22)';
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    const r = b.r, ry = r * 1.12;
    c.save();
    c.beginPath(); c.ellipse(b.x, b.y, r, ry, 0, 0, Math.PI * 2); c.clip();
    // the refracted, inverted view through the drop
    const k = 3.2; // how much of the scene the drop "sees"
    c.translate(b.x, b.y);
    c.scale(1, -1);
    c.drawImage(src, (b.x - r * k) * sx, (b.y - ry * k) * sy, r * k * 2 * sx, ry * k * 2 * sy, -r, -ry, r * 2, ry * 2);
    c.restore();
    // shading: dark lower rim, bright upper-left highlight
    c.drawImage(beadShade(), b.x - r, b.y - ry, r * 2, ry * 2);
  }
}

let shade = null;
/** Drop shading, rendered once: bright upper-left highlight, dark lower rim. */
function beadShade() {
  if (shade) return shade;
  shade = document.createElement('canvas');
  shade.width = shade.height = 64;
  const c = shade.getContext('2d');
  const g = c.createRadialGradient(64 * 0.35, 64 * 0.3, 3, 32, 32, 35);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.78, 'rgba(0,0,0,0)');
  g.addColorStop(0.95, 'rgba(0,10,25,0.5)');
  g.addColorStop(1, 'rgba(0,10,25,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(32, 32, 32, 0, Math.PI * 2); c.fill();
  return shade;
}

function lightning(near) {
  if (cfg.reducedMotion) return; // no flashes for people who asked for calm motion
  scene?.lightning(0.45 + near * 0.55);
}

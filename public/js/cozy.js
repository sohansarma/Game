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
// settings.cozySound: 'rain' | 'fire' | 'ocean' | 'rainfire'
// settings.cozyVol 0..1 · thunder bool · cozyWindow bool · sleepTimer minutes (0 = off)

import { onAudioReady, setNightAudio } from './audio.js';

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
const raining = () => cfg.cozySound === 'rain' || cfg.cozySound === 'rainfire';
const fireOn = () => cfg.cozySound === 'fire' || cfg.cozySound === 'rainfire';

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
  }
}

function emit() {
  document.body.classList.toggle('cozy', active);
  document.body.classList.toggle('cozy-fire', active && fireOn());
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
  if (fireOn()) {
    // the low roar of burning logs + crackles and the odd pop
    layer(A, noiseBuffer(ctx, 5, 'brown'), [['lowpass', 320]], 0.9);
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
// Behind the game (#bg): rain or stars + sky glow.
// Over the game (#cozy-over, pointer-events: none): lamp glow, vignette, drops on the glass.
let sky = null, glass = null, over = null, raf = null, flash = 0, W = 0, H = 0;
let drops = [], stars = [], beads = [];

function mkCanvas(parent, id) {
  const c = document.createElement('canvas');
  c.id = id;
  c.setAttribute('aria-hidden', 'true');
  parent.appendChild(c);
  return { el: c, ctx: c.getContext('2d') };
}

function startVisuals() {
  const bg = document.getElementById('bg');
  if (!bg || sky) return;
  sky = mkCanvas(bg, 'cozy-rain');
  over = document.createElement('div');
  over.id = 'cozy-over';
  over.setAttribute('aria-hidden', 'true');
  over.innerHTML = '<div class="cozy-lamp"></div><div class="cozy-vignette"></div>';
  document.body.appendChild(over);
  glass = mkCanvas(over, 'cozy-glass');
  window.addEventListener('resize', size);
  size();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    drawSky(dt, now);
    drawGlass(dt);
    if (fireOn() && !cfg.reducedMotion) {
      // the lamp breathes with the fire
      const f = 0.82 + 0.1 * Math.sin(now / 410) + 0.06 * Math.sin(now / 133) + 0.04 * Math.sin(now / 71);
      over.style.setProperty('--flicker', f.toFixed(3));
    } else over.style.setProperty('--flicker', '0.85');
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function size() {
  if (!sky) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  for (const c of [sky, glass]) {
    c.el.width = Math.round(W * dpr); c.el.height = Math.round(H * dpr);
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drops = Array.from({ length: Math.round((W * H) / 5200) }, () => newDrop(true));
  stars = Array.from({ length: Math.round((W * H) / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.75, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.28, s: 0.5 + Math.random() * 1.5 }));
  beads = [];
}

function syncVisuals() {
  if (sky) size();
}

function stopVisuals() {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', size);
  sky?.el.remove();
  over?.remove();
  sky = glass = over = null;
}

function newDrop(anywhere) {
  const z = Math.random();
  return { x: Math.random() * (W + 80) - 40, y: anywhere ? Math.random() * H : -20 - Math.random() * 60, z, len: 8 + z * 18, v: 380 + z * 620 };
}

function drawSky(dt, now) {
  const c = sky.ctx;
  c.clearRect(0, 0, W, H);
  if (flash > 0) {
    const g = c.createRadialGradient(W * 0.7, -H * 0.1, 10, W * 0.7, -H * 0.1, H * 1.1);
    g.addColorStop(0, `rgba(200,215,255,${0.38 * flash})`);
    g.addColorStop(1, 'rgba(200,215,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    flash = Math.max(0, flash - dt * 1.4);
  }
  const still = cfg.reducedMotion;
  if (!raining()) {
    // a clear, starry night
    for (const s of stars) {
      const tw = still ? 0.7 : 0.45 + 0.4 * Math.sin(now / 1000 * s.s + s.p);
      c.fillStyle = `rgba(255,248,225,${tw})`;
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
    }
    return;
  }
  const wind = 0.12;
  c.lineCap = 'round';
  for (const d of drops) {
    if (!still) {
      d.y += d.v * dt;
      d.x += d.v * wind * dt;
      if (d.y > H + 20) Object.assign(d, newDrop(false));
    }
    c.strokeStyle = `rgba(190,215,255,${0.12 + d.z * 0.28})`;
    c.lineWidth = 0.6 + d.z * 0.9;
    c.beginPath();
    c.moveTo(d.x, d.y);
    c.lineTo(d.x - d.len * wind, d.y - d.len);
    c.stroke();
  }
}

/** Water beads on the window: they sit, swell, then trickle down leaving a trail. */
function drawGlass(dt) {
  const c = glass.ctx;
  c.clearRect(0, 0, W, H);
  if (!raining() || !cfg.cozyWindow || cfg.reducedMotion) return;
  const max = Math.round((W * H) / 26000);
  if (beads.length < max && Math.random() < dt * 3) beads.push({ x: Math.random() * W, y: Math.random() * H * 0.9, r: 1.5 + Math.random() * 2.5, v: 0, trail: [] });
  for (const b of beads) {
    if (b.v === 0 && Math.random() < dt * 0.15) b.v = 18 + Math.random() * 40;
    if (b.v) {
      b.y += b.v * dt;
      b.x += Math.sin(b.y / 23) * 0.3;
      if (!b.trail.length || Math.abs(b.trail[b.trail.length - 1][1] - b.y) > 6) b.trail.push([b.x, b.y]);
      if (b.trail.length > 30) b.trail.shift();
    }
    // trail of tiny droplets
    for (const [i, [x, y]] of b.trail.entries()) {
      c.fillStyle = `rgba(220,235,255,${0.05 + (i / b.trail.length) * 0.1})`;
      c.beginPath(); c.arc(x, y, b.r * 0.35, 0, Math.PI * 2); c.fill();
    }
    // the bead: dark edge, bright highlight – like light bending through water
    const g = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(200,220,255,0.12)');
    g.addColorStop(1, 'rgba(10,20,40,0.25)');
    c.fillStyle = g;
    c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
  }
  beads = beads.filter((b) => b.y < H + 10);
}

function lightning(near) {
  if (cfg.reducedMotion) return; // no flashes for people who asked for calm motion
  flash = 0.45 + near * 0.55;
  setTimeout(() => { if (active) flash = Math.max(flash, 0.35 + near * 0.3); }, 140);
}

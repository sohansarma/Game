// Cozy rain – an optional night-time ambience: soft rain and distant thunder
// (synthesised live, no audio files), rain falling behind the game, a gentle
// lightning glow a moment before each roll of thunder, a calmer night tint,
// and a sleep timer that fades everything out.
//
// settings.cozy: 'off' | 'on' | 'night' (on automatically 9pm–6am)
// settings.cozyVol 0..1 · settings.thunder bool · settings.sleepTimer minutes (0 = off)

import { onAudioReady, setNightAudio } from './audio.js';

let cfg = { cozy: 'off', cozyVol: 0.6, thunder: true, sleepTimer: 0, reducedMotion: false };
let active = false;
let audio = null; // { ctx, bus, rainGain, nodes }
let thunderTimer = null;
let sleepTimer = null;
let sleptAt = 0;
let nightCheck = null;
let canvas = null, c2d = null, raf = null, drops = [], flash = 0, W = 0, H = 0;
const listeners = new Set();

export const isNightTime = (d = new Date()) => d.getHours() >= 21 || d.getHours() < 6;

/** Is the ambience on right now? */
export function cozyActive() {
  return active;
}
/** Has the sleep timer faded things out? */
export function cozySleeping() {
  return sleptAt > 0;
}
export function onCozyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Apply settings (call on start and whenever they change). */
export function configureCozy(settings) {
  const prevTimer = cfg.sleepTimer;
  cfg = { ...cfg, ...settings };
  if (prevTimer !== cfg.sleepTimer) sleptAt = 0;
  const want = cfg.cozy === 'on' || (cfg.cozy === 'night' && isNightTime());
  clearInterval(nightCheck);
  if (cfg.cozy === 'night') nightCheck = setInterval(() => configureCozy({}), 60000);
  if (want && !active) start();
  else if (!want && active) stop();
  else if (active) { setVolume(); armSleep(); scheduleThunder(); }
}

function emit() {
  document.body.classList.toggle('cozy', active);
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
  setNightAudio(false);
  clearTimeout(thunderTimer);
  clearTimeout(sleepTimer);
  if (audio) {
    const { ctx, bus, nodes } = audio;
    clearTimeout(audio.tickTimer);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => { for (const n of nodes) { try { n.stop?.(); n.disconnect(); } catch { /* ignore */ } } }, 2000);
    audio = null;
  }
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
      } else { // brown
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
  }
  return buf;
}

function startAudio(ctx, out) {
  if (audio) return;
  const nodes = [];
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  // 1) the hiss of rain: pink noise, band-limited
  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx, 4, 'pink');
  hiss.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.55;
  hiss.connect(hp); hp.connect(lp); lp.connect(hissGain); hissGain.connect(bus);
  // slow swells, like gusts of wind pushing the rain
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.18;
  lfo.connect(lfoAmt); lfoAmt.connect(hissGain.gain);
  // 2) rain on the roof: brown noise, low and warm
  const roof = ctx.createBufferSource();
  roof.buffer = noiseBuffer(ctx, 5, 'brown');
  roof.loop = true;
  const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 900;
  const roofGain = ctx.createGain(); roofGain.gain.value = 0.7;
  roof.connect(rl); rl.connect(roofGain); roofGain.connect(bus);
  hiss.start(); roof.start(); lfo.start();
  nodes.push(hiss, roof, lfo, hp, lp, hissGain, lfoAmt, rl, roofGain, bus);
  audio = { ctx, bus, nodes, out };
  // 3) individual drops: tiny filtered ticks on the window
  let dropBuf = null;
  const tick = () => {
    if (!audio || !active) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const src = ctx.createBufferSource();
      src.buffer = dropBuf || (dropBuf = noiseBuffer(ctx, 0.05, 'pink'));
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500 + Math.random() * 4000; bp.Q.value = 6;
      const g = ctx.createGain();
      const at = t + Math.random() * 0.25;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.35, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(audio.bus); }
      else { src.connect(bp); bp.connect(g); g.connect(audio.bus); }
      src.start(at); src.stop(at + 0.06);
    }
    audio.tickTimer = setTimeout(tick, 120 + Math.random() * 160);
  };
  tick();
  setVolume();
  scheduleThunder(true);
}

function setVolume() {
  if (!audio) return;
  const v = sleptAt ? 0 : Math.max(0, Math.min(1, cfg.cozyVol));
  audio.bus.gain.setTargetAtTime(v * 0.9, audio.ctx.currentTime, sleptAt ? 8 : 0.8);
}

function scheduleThunder(first = false) {
  clearTimeout(thunderTimer);
  if (!active || !cfg.thunder) return;
  const wait = first ? 6000 + Math.random() * 8000 : 25000 + Math.random() * 45000;
  thunderTimer = setTimeout(() => {
    if (!active || sleptAt) return;
    const near = Math.random(); // 0 far .. 1 nearer (still never sharp)
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
  const peak = 0.8 + near * 0.9; // the rain bus applies the volume
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.25 + (1 - near) * 0.9);
  // a couple of rolling bumps
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
    setNightAudio(true);
    emit();
    for (const fn of sleepFns) { try { fn(); } catch { /* ignore */ } }
  }, cfg.sleepTimer * 60000);
}
const sleepFns = new Set();
export function onSleep(fn) {
  sleepFns.add(fn);
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
function startVisuals() {
  const bg = document.getElementById('bg');
  if (!bg || canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'cozy-rain';
  canvas.setAttribute('aria-hidden', 'true');
  bg.appendChild(canvas);
  c2d = canvas.getContext('2d');
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((W * H) / 5200);
    drops = Array.from({ length: n }, () => newDrop(true));
  };
  size();
  canvas._resize = size;
  window.addEventListener('resize', size);
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    drawRain(dt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function stopVisuals() {
  cancelAnimationFrame(raf);
  if (canvas) {
    window.removeEventListener('resize', canvas._resize);
    canvas.remove();
  }
  canvas = null;
}

function newDrop(anywhere) {
  const z = Math.random(); // depth: far drops are small, faint and slow
  return { x: Math.random() * (W + 80) - 40, y: anywhere ? Math.random() * H : -20 - Math.random() * 60, z, len: 8 + z * 18, v: 380 + z * 620 };
}

function drawRain(dt) {
  if (!c2d) return;
  c2d.clearRect(0, 0, W, H);
  if (flash > 0) {
    // soft sky glow – never a hard white strobe
    const g = c2d.createRadialGradient(W * 0.7, -H * 0.1, 10, W * 0.7, -H * 0.1, H * 1.1);
    g.addColorStop(0, `rgba(200,215,255,${0.38 * flash})`);
    g.addColorStop(1, 'rgba(200,215,255,0)');
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, W, H);
    flash = Math.max(0, flash - dt * 1.4);
  }
  const still = cfg.reducedMotion;
  const wind = 0.12;
  c2d.lineCap = 'round';
  for (const d of drops) {
    if (!still) {
      d.y += d.v * dt;
      d.x += d.v * wind * dt;
      if (d.y > H + 20) Object.assign(d, newDrop(false));
    }
    c2d.strokeStyle = `rgba(190,215,255,${0.12 + d.z * 0.28})`;
    c2d.lineWidth = 0.6 + d.z * 0.9;
    c2d.beginPath();
    c2d.moveTo(d.x, d.y);
    c2d.lineTo(d.x - d.len * wind, d.y - d.len);
    c2d.stroke();
  }
}

function lightning(near) {
  if (cfg.reducedMotion) return; // no flashes for people who asked for calm motion
  flash = 0.45 + near * 0.55;
  setTimeout(() => { if (active) flash = Math.max(flash, 0.35 + near * 0.3); }, 140); // flicker
}

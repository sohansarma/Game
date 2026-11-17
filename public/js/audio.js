// All sound is synthesised live with WebAudio – no audio files to download.
// Signal chain:  voices ─┬─> dry ──────────────┐
//                        └─> reverb (convolver) ┴─> compressor ─> speakers
// Music runs on its own bus with a soft low-pass so it sits under the SFX.

let ctx = null;
let out = null; // compressor
let sfxBus = null;
let musicBus = null;
let reverb = null;
let musicTimer = null;
let settings = { sfx: true, music: true, haptics: true };

export function configureAudio(s) {
  settings = s;
  if (!s.music) stopMusic();
  else if (ctx) startMusic();
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createDynamicsCompressor();
  out.threshold.value = -14;
  out.ratio.value = 4;
  out.connect(ctx.destination);

  reverb = ctx.createConvolver();
  reverb.buffer = impulse(1.8, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet);
  wet.connect(out);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.55;
  sfxBus.connect(out);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.16;
  musicBus.connect(lp);
  lp.connect(out);
  const musicVerb = ctx.createGain();
  musicVerb.gain.value = 0.6;
  musicBus.connect(musicVerb);
  musicVerb.connect(reverb);

  if (settings.music) startMusic();
}

// Exponentially decaying stereo noise = a small, soft "room".
function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// ---------------------------------------------------------------- voices
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function route(node, { pan = 0, verb = 0.3, bus } = {}) {
  let n = node;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    n.connect(p);
    n = p;
  }
  n.connect(bus || sfxBus);
  if (verb > 0) {
    const s = ctx.createGain();
    s.gain.value = verb;
    n.connect(s);
    s.connect(reverb);
  }
}

/** Simple oscillator note with optional pitch glide. */
function tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, to, attack = 0.005, pan, verb = 0.25, bus } = {}) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur * 0.9);
  env(g, t, attack, vol, dur);
  o.connect(g);
  route(g, { pan, verb, bus });
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** FM bell: bright, glassy, decays naturally. */
function bell(freq, dur = 0.9, { vol = 0.25, when = 0, ratio = 3.5, index = 2.2, pan, verb = 0.45, bus } = {}) {
  const t = ctx.currentTime + when;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const g = ctx.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * ratio;
  modGain.gain.setValueAtTime(freq * index, t);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
  mod.connect(modGain);
  modGain.connect(car.frequency);
  env(g, t, 0.003, vol, dur);
  car.connect(g);
  route(g, { pan, verb, bus });
  car.start(t); mod.start(t);
  car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
}

/** Marimba-ish pluck: sine + quick 4th harmonic. */
function marimba(freq, dur = 0.5, { vol = 0.3, when = 0, pan, verb = 0.3, bus } = {}) {
  tone(freq, dur, { type: 'sine', vol, when, pan, verb, bus, attack: 0.002 });
  tone(freq * 4, dur * 0.18, { type: 'sine', vol: vol * 0.35, when, pan, verb: 0, bus, attack: 0.001 });
}

/** Filtered noise burst, optionally sweeping the filter. */
function noise(dur, { vol = 0.25, when = 0, type = 'bandpass', from = 800, to = 800, q = 1, pan, verb = 0.2 } = {}) {
  const t = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
  const g = ctx.createGain();
  env(g, t, 0.004, vol, dur);
  src.connect(f);
  f.connect(g);
  route(g, { pan, verb });
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Bubble pop: a sine that chirps upward very fast. */
function bubble(base, { vol = 0.35, when = 0, pan } = {}) {
  tone(base, 0.09, { vol, when, to: base * 2.6, pan, verb: 0.35, attack: 0.002 });
  noise(0.03, { vol: vol * 0.25, when, type: 'highpass', from: 3000, to: 5000, pan, verb: 0 });
}

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const pent = (root, step) => root * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
const ok = () => ctx && settings.sfx;

// ---------------------------------------------------------------- effects
export const sfx = {
  tap() {
    if (!ok()) return;
    tone(1250, 0.04, { type: 'triangle', vol: 0.12, to: 900, verb: 0.05 });
  },
  swap() {
    if (!ok()) return;
    noise(0.14, { vol: 0.12, from: 500, to: 2200, q: 2.5, verb: 0.1 });
    tone(520, 0.08, { vol: 0.08, to: 700, verb: 0.05 });
  },
  bad() {
    if (!ok()) return;
    tone(330, 0.09, { type: 'square', vol: 0.06, verb: 0.05 });
    tone(247, 0.14, { type: 'square', vol: 0.06, when: 0.09, verb: 0.05 });
  },
  // Each cascade step climbs the scale, so chains "sing" upward.
  match(cascade = 1) {
    if (!ok()) return;
    const step = Math.min(cascade - 1, 12);
    const f = pent(523.25, step);
    marimba(f, 0.45, { vol: 0.24, pan: (Math.random() - 0.5) * 0.6 });
    bubble(260 + step * 40, { vol: 0.22, when: 0.01, pan: (Math.random() - 0.5) * 0.8 });
    bubble(340 + step * 50, { vol: 0.16, when: 0.06, pan: (Math.random() - 0.5) * 0.8 });
    if (cascade >= 3) bell(f * 2, 0.6, { vol: 0.1, when: 0.05 });
  },
  special() {
    if (!ok()) return;
    [0, 2, 4].forEach((s, i) => bell(pent(784, s), 0.7, { vol: 0.14, when: i * 0.06, pan: -0.4 + i * 0.4 }));
    noise(0.35, { vol: 0.06, type: 'highpass', from: 4000, to: 9000, verb: 0.5 });
  },
  zap() { // Wave: a rushing water sweep across the stereo field
    if (!ok()) return;
    noise(0.45, { vol: 0.22, from: 300, to: 3500, q: 1.2, pan: -0.6, verb: 0.35 });
    noise(0.45, { vol: 0.18, from: 400, to: 4200, q: 1.2, when: 0.05, pan: 0.6, verb: 0.35 });
    tone(880, 0.3, { type: 'sawtooth', vol: 0.03, to: 220, verb: 0.2 });
  },
  boom() { // Bubble Bomb: deep thump + fizz
    if (!ok()) return;
    tone(140, 0.45, { vol: 0.5, to: 38, verb: 0.3, attack: 0.002 });
    noise(0.5, { vol: 0.3, type: 'lowpass', from: 1800, to: 120, verb: 0.4 });
    for (let i = 0; i < 5; i++) bubble(300 + Math.random() * 500, { vol: 0.12, when: 0.08 + i * 0.05, pan: Math.random() * 2 - 1 });
  },
  rainbow() { // Pearl: a sparkling glissando
    if (!ok()) return;
    for (let i = 0; i < 10; i++) bell(pent(523.25, i), 0.8, { vol: 0.11, when: i * 0.035, pan: -0.8 + i * 0.16 });
    noise(0.8, { vol: 0.05, type: 'highpass', from: 5000, to: 10000, verb: 0.6 });
  },
  dice() { // a few clacks as the die tumbles, then it settles
    if (!ok()) return;
    for (let i = 0; i < 5; i++) {
      const w = i * 0.07 + Math.random() * 0.02;
      tone(300 + Math.random() * 500, 0.05, { type: 'triangle', vol: 0.18 - i * 0.02, when: w, verb: 0.05, attack: 0.001 });
      noise(0.03, { vol: 0.12, type: 'highpass', from: 2000, to: 3000, when: w, verb: 0 });
    }
    tone(180, 0.12, { vol: 0.25, when: 0.42, to: 120, verb: 0.1, attack: 0.001 });
  },
  place() { // Reef Blocks: soft wooden "thock"
    if (!ok()) return;
    tone(190, 0.12, { vol: 0.32, to: 120, verb: 0.08, attack: 0.001 });
    noise(0.025, { vol: 0.12, type: 'highpass', from: 2500, to: 2500, verb: 0 });
  },
  lines(n = 1, combo = 1) { // Reef Blocks line clear
    if (!ok()) return;
    const root = pent(392, Math.min(combo - 1, 8));
    for (let i = 0; i < Math.min(n + 1, 5); i++) marimba(pent(root, i * 2), 0.5, { vol: 0.2, when: i * 0.07, pan: -0.5 + i * 0.25 });
    noise(0.3, { vol: 0.1, from: 600, to: 3000, q: 1, verb: 0.3 });
  },
  coin() {
    if (!ok()) return;
    bell(1318.5, 0.35, { vol: 0.14, ratio: 2, index: 1.2 });
    bell(1975.5, 0.5, { vol: 0.14, ratio: 2, index: 1.2, when: 0.08 });
  },
  star(i) {
    if (!ok()) return;
    bell(pent(784, i * 2), 1.1, { vol: 0.22, ratio: 2.76, index: 2.5 });
    bubble(500 + i * 120, { vol: 0.15, when: 0.02 });
  },
  win() {
    if (!ok()) return;
    const mel = [0, 2, 4, 5, 7];
    mel.forEach((s, i) => marimba(pent(523.25, s), 0.5, { vol: 0.26, when: i * 0.11 }));
    [261.6, 329.6, 392].forEach((f) => tone(f, 1.4, { type: 'triangle', vol: 0.08, when: 0.55, attack: 0.05, verb: 0.5 }));
    bell(1046.5, 1.4, { vol: 0.18, when: 0.55 });
  },
  lose() {
    if (!ok()) return;
    [392, 370, 349, 311].forEach((f, i) => tone(f, i === 3 ? 0.7 : 0.28, { type: 'triangle', vol: 0.16, when: i * 0.26, to: i === 3 ? f * 0.85 : undefined, verb: 0.3 }));
  },
};

export function haptic(ms = 15) {
  if (settings.haptics && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- music
// A gentle, endlessly varying marimba groove (I–vi–IV–V in C) with a soft
// bass and pad, scheduled ahead on the audio clock so timing never drifts.
const CHORDS = [
  { root: 261.63, notes: [0, 4, 7] }, // C
  { root: 220.0, notes: [0, 3, 7] }, // Am
  { root: 174.61, notes: [0, 4, 7] }, // F
  { root: 196.0, notes: [0, 4, 7] }, // G
];
const BPM = 92;
let nextTime = 0;
let step = 0;

function scheduleStep(t) {
  const eighth = 60 / BPM / 2;
  const bar = Math.floor(step / 8) % CHORDS.length;
  const pos = step % 8;
  const ch = CHORDS[bar];
  const semis = (s) => Math.pow(2, s / 12);
  const when = t - ctx.currentTime;
  if (pos === 0) {
    tone(ch.root / 2, eighth * 7, { type: 'triangle', vol: 0.55, when, attack: 0.02, verb: 0.1, bus: musicBus });
    for (const n of ch.notes) tone(ch.root * semis(n), eighth * 8, { type: 'sine', vol: 0.12, when, attack: 0.25, verb: 0.6, bus: musicBus });
  }
  if (pos === 4) tone(ch.root / 2 * 1.5, eighth * 3, { type: 'triangle', vol: 0.35, when, attack: 0.02, verb: 0.1, bus: musicBus });
  // melody: arpeggio with gentle variation every other lap
  const lap = Math.floor(step / 32);
  const pattern = lap % 2 ? [0, 2, 1, 2, 0, 1, 2, 1] : [0, 1, 2, 1, 2, 1, 0, 2];
  if (!(lap % 3 === 2 && pos % 2 === 1)) {
    const n = ch.notes[pattern[pos]] + (pos >= 4 ? 12 : 0);
    marimba(ch.root * 2 * semis(n) / 2, 0.6, { vol: 0.5, when, pan: pos % 2 ? 0.3 : -0.3, verb: 0.5, bus: musicBus });
  }
  step++;
}

function startMusic() {
  if (!ctx || musicTimer) return;
  nextTime = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    const eighth = 60 / BPM / 2;
    while (nextTime < ctx.currentTime + 0.25) {
      scheduleStep(nextTime);
      nextTime += eighth;
    }
  }, 60);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else {
      ctx.resume();
      nextTime = ctx.currentTime + 0.1; // don't burst-play missed notes
    }
  });
}

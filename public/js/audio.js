// All sound is synthesised with WebAudio – no audio files to download.

let ctx = null;
let master = null;
let musicGain = null;
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
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.12;
  musicGain.connect(master);
  if (settings.music) startMusic();
}

function tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, slide = 0, dest } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, vol = 0.2) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const note = (base, i) => base * Math.pow(2, PENTA[Math.min(i, PENTA.length - 1)] / 12);

export const sfx = {
  tap() { if (settings.sfx) tone(660, 0.06, { type: 'triangle', vol: 0.15 }); },
  swap() { if (settings.sfx) tone(420, 0.09, { type: 'sine', vol: 0.18, slide: 1.4 }); },
  bad() { if (settings.sfx) tone(220, 0.15, { type: 'square', vol: 0.08, slide: 0.7 }); },
  match(cascade = 1) {
    if (!settings.sfx) return;
    const f = note(523, cascade - 1);
    tone(f, 0.18, { type: 'triangle', vol: 0.25 });
    tone(f * 1.5, 0.12, { type: 'sine', vol: 0.12, when: 0.03 });
  },
  special() { if (settings.sfx) { tone(880, 0.25, { type: 'sawtooth', vol: 0.08, slide: 2 }); tone(1320, 0.2, { vol: 0.12, when: 0.05 }); } },
  boom() { if (settings.sfx) { noise(0.35, 0.35); tone(110, 0.3, { type: 'sine', vol: 0.3, slide: 0.5 }); } },
  zap() { if (settings.sfx) tone(1200, 0.25, { type: 'sawtooth', vol: 0.07, slide: 0.3 }); },
  place() { if (settings.sfx) tone(300, 0.07, { type: 'triangle', vol: 0.2 }); },
  coin() { if (settings.sfx) { tone(988, 0.08, { type: 'square', vol: 0.08 }); tone(1319, 0.2, { type: 'square', vol: 0.08, when: 0.08 }); } },
  win() {
    if (!settings.sfx) return;
    [0, 2, 4, 7].forEach((i, k) => tone(note(523, i), 0.3, { type: 'triangle', vol: 0.25, when: k * 0.12 }));
  },
  lose() {
    if (!settings.sfx) return;
    [4, 2, 0].forEach((i, k) => tone(note(330, i), 0.35, { type: 'sine', vol: 0.2, when: k * 0.18 }));
  },
  star(i) { if (settings.sfx) tone(note(784, i * 2), 0.25, { type: 'triangle', vol: 0.25 }); },
};

export function haptic(ms = 15) {
  if (settings.haptics && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

// Gentle generative "ocean" music: a slow pentatonic arpeggio.
function startMusic() {
  if (!ctx || musicTimer) return;
  const chords = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
  let step = 0;
  const base = 262;
  const play = () => {
    const chord = chords[Math.floor(step / 8) % chords.length];
    const n = chord[step % 3] + (step % 8 >= 4 ? 12 : 0);
    tone(base * Math.pow(2, n / 12), 0.9, { type: 'sine', vol: 0.25, dest: musicGain });
    if (step % 8 === 0) tone((base / 2) * Math.pow(2, chord[0] / 12), 2.4, { type: 'triangle', vol: 0.2, dest: musicGain });
    step++;
  };
  musicTimer = setInterval(play, 380);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) { ctx.suspend(); } else { ctx.resume(); }
});

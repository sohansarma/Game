// Talks to chess-worker.js; falls back to the main thread if workers are unavailable.
import { Chess, casualMoveScored } from './chess.js';
import { findPuzzleAsync } from './chess-puzzles.js';

let worker = null, failed = false, seq = 0;
const pending = new Map();

function getWorker() {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./chess-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
    worker.onerror = () => { failed = true; worker = null; for (const p of pending.values()) p({ error: 'worker' }); pending.clear(); };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

function ask(msg, timeoutMs) {
  const w = getWorker();
  if (!w) return Promise.resolve({ error: 'noworker' });
  return new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    w.postMessage({ ...msg, id });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ error: 'timeout' }); } }, timeoutMs);
  });
}

/** The bot's move + its evaluation, computed without freezing the board. */
export async function botMove(ucis, level) {
  const r = await ask({ kind: 'move', ucis, level }, 20000);
  if (!r.error && r.uci) return r;
  const g = new Chess();
  for (const u of ucis) g.play(u);
  const m = casualMoveScored(g, level, { next: Math.random });
  return { uci: m?.uci || null, score: m?.score ?? 0 };
}

/** Today's (or any seed's) puzzle, cached in this browser. */
export async function puzzleFor(seed) {
  const key = 'tidepop.puzzle.' + seed;
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch { /* storage blocked */ }
  let p = null;
  const r = await ask({ kind: 'puzzle', seed }, 40000);
  if (!r.error) p = r.puzzle;
  else p = await findPuzzleAsync(seed);
  try { if (p) localStorage.setItem(key, JSON.stringify(p)); } catch { /* full */ }
  return p;
}

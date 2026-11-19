// Talks to chess-worker.js; falls back to the main thread if workers are unavailable.
import { Chess, casualMoveScored } from './chess.js';
import { findPuzzleAsync } from './chess-puzzles.js';

let worker = null, failed = false, seq = 0;
const pending = new Map();
const progressFns = new Map();

function getWorker() {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./chess-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.progress !== undefined) { progressFns.get(e.data.id)?.(e.data.progress); return; }
      const p = pending.get(e.data.id);
      if (p) { pending.delete(e.data.id); progressFns.delete(e.data.id); p(e.data); }
    };
    worker.onerror = () => { failed = true; worker = null; for (const p of pending.values()) p({ error: 'worker' }); pending.clear(); };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

function ask(msg, timeoutMs, onProgress) {
  const w = getWorker();
  if (!w) return Promise.resolve({ error: 'noworker' });
  return new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    if (onProgress) progressFns.set(id, onProgress);
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

/** A hint (the move a strong bot would play), computed off the main thread. */
export async function hintMove(ucis, level) {
  const r = await ask({ kind: 'move', ucis, level }, 15000);
  return r.error ? null : r.uci;
}

/** Post-game review: per move, the engine's best move and what the played move scored. */
export async function reviewGame(ucis, onProgress) {
  const r = await ask({ kind: 'review', ucis }, 120000, onProgress);
  return r.error ? null : r.review;
}

/** Today's (or any seed's) puzzle, cached in this browser. */
export async function puzzleFor(seed, multi = false) {
  const key = `tidepop.puzzle.v3.${multi ? 'm' : ''}${seed}`;
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c); } catch { /* storage blocked */ }
  let p = null;
  const r = await ask({ kind: 'puzzle', seed, multi }, 90000);
  if (!r.error) p = r.puzzle;
  else p = await findPuzzleAsync(seed, multi);
  try { if (p) localStorage.setItem(key, JSON.stringify(p)); } catch { /* full */ }
  return p;
}

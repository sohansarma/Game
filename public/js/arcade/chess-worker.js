// Runs the chess bot off the main thread so the board never freezes.
import { Chess, casualMoveScored, searchMove } from './chess.js';
import { findPuzzle } from './chess-puzzles.js';

const rngOf = () => ({ next: Math.random });
const evalPos = (g) => searchMove(g, { depth: 2, budget: 12000 }, { next: () => 0.5 });

self.onmessage = (e) => {
  const { id, kind, ucis, level, seed } = e.data;
  try {
    if (kind === 'puzzle') { self.postMessage({ id, puzzle: findPuzzle(seed) }); return; }
    const g = new Chess();
    for (const u of ucis) g.play(u);
    if (kind === 'review') {
      // for every move: the engine's best move and how much the played move gave away
      const out = [];
      const h = new Chess();
      for (let i = 0; i < ucis.length; i++) {
        const best = evalPos(h.clone());
        const after = h.clone();
        after.play(ucis[i]);
        let played;
        if (!after.moves().length) played = after.inCheck() ? 100000 : 0;
        else { const r = evalPos(after.clone()); played = r ? -r.score : 0; }
        out.push({ ply: i, best: best?.uci || null, bestScore: best?.score ?? 0, played });
        h.play(ucis[i]);
        if (i % 8 === 7) self.postMessage({ id, progress: (i + 1) / ucis.length });
      }
      self.postMessage({ id, review: out });
      return;
    }
    const r = casualMoveScored(g, level, rngOf());
    self.postMessage({ id, uci: r?.uci || null, score: r?.score ?? 0 });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};

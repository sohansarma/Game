// Runs the chess bot off the main thread so the board never freezes.
import { Chess, casualMoveScored, scoreAll } from './chess.js';
import { findPuzzle } from './chess-puzzles.js';

self.onmessage = (e) => {
  const { id, kind, ucis, level, seed } = e.data;
  try {
    if (kind === 'puzzle') { self.postMessage({ id, puzzle: findPuzzle(seed) }); return; }
    const g = new Chess();
    for (const u of ucis) g.play(u);
    const r = casualMoveScored(g, level, { next: Math.random });
    self.postMessage({ id, uci: r?.uci || null, score: r?.score ?? 0 });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
void scoreAll;

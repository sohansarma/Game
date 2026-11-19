// Runs the chess bot off the main thread so the board never freezes.
import { Chess, casualMoveScored, scoreAll } from './chess.js';
import { findPuzzle } from './chess-puzzles.js';

const rngOf = () => ({ next: Math.random });

self.onmessage = (e) => {
  const { id, kind, ucis, level, seed, multi } = e.data;
  try {
    if (kind === 'puzzle') { self.postMessage({ id, puzzle: findPuzzle(seed, !!multi) }); return; }
    const g = new Chess();
    for (const u of ucis) g.play(u);
    if (kind === 'review') {
      // for every move: the engine's best move and how much the played move gave away
      const out = [];
      const h = new Chess();
      for (let i = 0; i < ucis.length; i++) {
        // every move of the position scored in ONE search (same depth for all) …
        const sc = scoreAll(h, 3, 60000);
        const best = sc[0];
        const mine = sc.find((x) => x.uci === ucis[i]);
        // … and the played move also gets a deeper look from the position after it, so a sound sacrifice isn't marked as a mistake
        const after = h.clone();
        after.play(ucis[i]);
        let deeper;
        if (!after.moves().length) deeper = after.inCheck() ? 100000 : 0;
        else { const r = scoreAll(after, 3, 60000)[0]; deeper = r ? -r.v : 0; }
        const played = Math.max(mine ? mine.v : -1e9, deeper);
        out.push({ ply: i, best: best?.uci || null, bestScore: best?.v ?? 0, played });
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

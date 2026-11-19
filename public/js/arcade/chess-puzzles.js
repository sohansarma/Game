// Daily chess puzzles, generated deterministically from a seed (same for
// everyone each day). A seeded self-play game is scanned for a position where
// the side to move has ONE clearly best move that wins material or mates;
// the solution line continues while the next move is also clearly best.

import { Chess, casualMove, scoreAll, evaluate, name } from './chess.js';
import { Rng } from '../rng.js';

const MATE = 50000;

/** { start: [uci…], side, line: [uci…], accept: [[uci…] per your move], theme } */
export function findPuzzle(seed) {
  const it = puzzleSteps(seed);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/** Same search, but yields to the page between positions (no freezes without a worker). */
export async function findPuzzleAsync(seed) {
  const it = puzzleSteps(seed);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await new Promise((res) => setTimeout(res, 0));
  }
}

/** How hard a puzzle is (Elo-ish): longer lines, quiet first moves and mates are harder. */
export function puzzleDifficulty(g0, p) {
  const yours = Math.ceil(p.line.length / 2);
  const g = g0.clone();
  const m = g.moves().find((x) => name(x.from) + name(x.to) + (x.promo || '') === p.line[0]);
  const quiet = m && !g.board[m.to];
  return 800 + (yours - 1) * 250 + (quiet ? 250 : 0) + (p.theme === 'Mate' ? 150 : 0);
}

function* puzzleSteps(seed) {
  let fallback = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rng = new Rng((seed + attempt * 7919) >>> 0);
    const g = new Chess();
    const start = [];
    for (let ply = 0; ply < 80 && !g.result(); ply++) {
      if (ply >= 12) {
        const p = tryPosition(g);
        // not a plain recapture of the piece that was just taken
        const last = start[start.length - 1];
        const recapture = p && last && p.line[0].slice(2, 4) === last.slice(2, 4);
        if (p && !recapture) {
          const full = { start: start.slice(), ...p, difficulty: puzzleDifficulty(g, p) };
          if (p.line.length >= 3) return full; // a real combination: two or more of your moves
          fallback ||= full;
          if (attempt >= 3 && fallback) return fallback;
        }
        yield null;
      }
      // a sloppy-ish game produces natural tactical chances
      const uci = casualMove(g, ply % 2 ? 1 : 2, rng);
      if (!uci) break;
      g.play(uci);
      start.push(uci);
    }
  }
  return fallback;
}

function tryPosition(g0) {
  const before = evaluate(g0);
  if (Math.abs(before) > 150) return null; // not already decided
  // cheap screen first: a 1-ply search with captures must already show a big gap
  const quick = scoreAll(g0, 1, 4000);
  if (quick.length < 2 || !(quick[0].v >= MATE || (quick[0].v >= 200 && quick[0].v - quick[1].v >= 200))) return null;
  const scores = scoreAll(g0, 2, 20000);
  if (scores.length < 2) return null;
  const [best, second] = scores;
  const decisive = best.v >= MATE || (best.v >= 250 && best.v - second.v >= 250);
  if (!decisive) return null;
  const g = g0.clone();
  const side = g.turn;
  const line = [];
  const accept = [];
  let cur = scores;
  for (let step = 0; step < 3; step++) {
    const top = cur[0];
    const ok = cur.filter((x) => x.v >= top.v - (top.v >= MATE ? 0 : 60)).map((x) => x.uci);
    if (ok.length > 2 && step > 0) break; // not forced any more
    line.push(top.uci);
    accept.push(ok);
    g.play(top.uci);
    if (g.result()) break;
    // the opponent's best defence
    const reply = scoreAll(g, 2, 15000)[0];
    if (!reply) break;
    // keep going only if our next move is again clearly the best
    const g2 = g.clone();
    g2.play(reply.uci);
    if (g2.result()) break;
    const nxt = scoreAll(g2, 2, 15000);
    if (nxt.length < 2 || !(nxt[0].v >= MATE || nxt[0].v - nxt[1].v >= 250)) break;
    line.push(reply.uci);
    g.play(reply.uci);
    cur = nxt;
  }
  return { side, line, accept, theme: best.v >= MATE ? 'Mate' : 'Win material', value: best.v };
}

/** A puzzle you play on the normal chess board (same API as the casual sims). */
export class ChessPuzzleSim {
  constructor(puzzle, { name: me = 'You' } = {}) {
    this.puzzle = puzzle;
    this.game = new Chess();
    for (const u of puzzle.start) this.game.play(u);
    this.mySide = puzzle.side;
    this.names = { [this.mySide]: me, [this.mySide === 'w' ? 'b' : 'w']: '🧩 Puzzle' };
    this.step = 0; // index into line (your moves are even)
    this.mistakes = 0;
    this.hintsUsed = 0;
    this.over = false;
    this.result = null;
    this.moves = puzzle.start.slice();
    this.onWrong = null;
  }
  canMove() { return !this.over && this.game.turn === this.mySide; }
  botToMove() { return false; }
  move(uci) {
    if (!this.canMove()) return { ok: false };
    const ok = this.puzzle.accept[this.step / 2] || [this.puzzle.line[this.step]];
    if (!ok.includes(uci) && !ok.includes(uci.slice(0, 4))) {
      this.mistakes++;
      this.onWrong?.(this.mistakes);
      return { ok: false, wrong: true };
    }
    const human = this.game.play(uci);
    if (!human) return { ok: false };
    this.moves.push(uci);
    this.step++;
    const out = { ok: true, human };
    const reply = this.puzzle.line[this.step];
    if (reply && !this.game.result()) {
      out.ai = this.game.play(reply);
      this.moves.push(reply);
      this.step++;
    }
    if (this.step >= this.puzzle.line.length || this.game.result()) {
      this.over = true;
      this.result = { winner: this.mySide, reason: 'Puzzle solved' };
      out.end = this.result;
    }
    return out;
  }
  hint() {
    if (!this.canMove()) return null;
    this.hintsUsed++;
    return this.puzzle.line[this.step];
  }
  resign() { this.over = true; this.result = { winner: null, reason: 'Gave up' }; }
}

void name;

// Chess – full rules engine + deterministic AI. Pure (no DOM).
//
// Modes: 'ladder' (default, ranked): you play White vs an AI that gets
// stronger every win; a loss ends the run. 'local' (pass & play) and
// 'online' matches use the same engine but are not scored.
//
// Board: 0..63, a8 = 0 ... h1 = 63. Pieces: 'P','N','B','R','Q','K' (white)
// and lowercase for black. Moves are encoded as "e2e4" / "e7e8q".

import { Rng } from '../rng.js';

const FILES = 'abcdefgh';
export const sq = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
export const name = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
const isWhite = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (isWhite(p) ? 'w' : 'b') : null);

const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';

export class Chess {
  constructor() {
    this.board = START.split('').map((c) => (c === '.' ? null : c));
    this.turn = 'w';
    this.castle = { K: true, Q: true, k: true, q: true };
    this.ep = -1;
    this.half = 0; // half-move clock (50-move rule)
    this.ply = 0;
    this.history = [];
    this.positions = new Map();
    this.notePosition();
  }

  clone() {
    const c = Object.create(Chess.prototype);
    c.board = this.board.slice();
    c.turn = this.turn;
    c.castle = { ...this.castle };
    c.ep = this.ep;
    c.half = this.half;
    c.ply = this.ply;
    c.history = [];
    c.positions = new Map(this.positions);
    return c;
  }

  key() {
    return this.board.map((p) => p || '.').join('') + this.turn + Object.entries(this.castle).filter(([, v]) => v).map(([k]) => k).join('') + this.ep;
  }
  notePosition() {
    const k = this.key();
    this.positions.set(k, (this.positions.get(k) || 0) + 1);
  }

  kingSq(color) {
    const k = color === 'w' ? 'K' : 'k';
    return this.board.indexOf(k);
  }

  attacked(i, by) {
    const B = this.board;
    const r = Math.floor(i / 8), c = i % 8;
    const at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? B[rr * 8 + cc] : undefined);
    const own = (p, t) => p && colorOf(p) === by && p.toUpperCase() === t;
    // pawns
    const dir = by === 'w' ? 1 : -1; // white pawns attack upward (towards lower r)
    if (own(at(r + dir, c - 1), 'P') || own(at(r + dir, c + 1), 'P')) return true;
    // knights
    for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) if (own(at(r + dr, c + dc), 'N')) return true;
    // king
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && own(at(r + dr, c + dc), 'K')) return true;
    // sliders
    const rays = [[1, 0, 'RQ'], [-1, 0, 'RQ'], [0, 1, 'RQ'], [0, -1, 'RQ'], [1, 1, 'BQ'], [1, -1, 'BQ'], [-1, 1, 'BQ'], [-1, -1, 'BQ']];
    for (const [dr, dc, types] of rays) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = B[rr * 8 + cc];
        if (p) {
          if (colorOf(p) === by && types.includes(p.toUpperCase())) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.attacked(this.kingSq(color), color === 'w' ? 'b' : 'w');
  }

  pseudoMoves() {
    const B = this.board, me = this.turn, out = [];
    const add = (f, t, promo) => out.push({ from: f, to: t, promo });
    for (let i = 0; i < 64; i++) {
      const p = B[i];
      if (!p || colorOf(p) !== me) continue;
      const r = Math.floor(i / 8), c = i % 8, T = p.toUpperCase();
      const empty = (rr, cc) => rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !B[rr * 8 + cc];
      const enemy = (rr, cc) => rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && B[rr * 8 + cc] && colorOf(B[rr * 8 + cc]) !== me;
      if (T === 'P') {
        const d = me === 'w' ? -1 : 1, startR = me === 'w' ? 6 : 1, lastR = me === 'w' ? 0 : 7;
        const push = (to) => { if (Math.floor(to / 8) === lastR) for (const q of 'qrbn') add(i, to, q); else add(i, to); };
        if (empty(r + d, c)) {
          push((r + d) * 8 + c);
          if (r === startR && empty(r + 2 * d, c)) add(i, (r + 2 * d) * 8 + c);
        }
        for (const dc of [-1, 1]) {
          const to = (r + d) * 8 + c + dc;
          if (enemy(r + d, c + dc)) push(to);
          else if (c + dc >= 0 && c + dc < 8 && to === this.ep) add(i, to);
        }
      } else if (T === 'N' || T === 'K') {
        const deltas = T === 'N' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dr, dc] of deltas) if (empty(r + dr, c + dc) || enemy(r + dr, c + dc)) add(i, (r + dr) * 8 + c + dc);
        if (T === 'K') {
          const opp = me === 'w' ? 'b' : 'w';
          const row = me === 'w' ? 7 : 0;
          if (i === row * 8 + 4 && !this.attacked(i, opp)) {
            const [ks, qs] = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
            if (this.castle[ks] && !B[row * 8 + 5] && !B[row * 8 + 6] && !this.attacked(row * 8 + 5, opp)) add(i, row * 8 + 6);
            if (this.castle[qs] && !B[row * 8 + 3] && !B[row * 8 + 2] && !B[row * 8 + 1] && !this.attacked(row * 8 + 3, opp)) add(i, row * 8 + 2);
          }
        }
      } else {
        const dirs = T === 'B' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : T === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const q = B[rr * 8 + cc];
            if (!q) add(i, rr * 8 + cc);
            else { if (colorOf(q) !== me) add(i, rr * 8 + cc); break; }
            rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }

  moves() {
    const me = this.turn;
    return this.pseudoMoves().filter((m) => {
      const u = this.makeRaw(m);
      const ok = !this.attacked(this.kingSq(me), me === 'w' ? 'b' : 'w');
      this.unmakeRaw(u);
      return ok;
    });
  }

  // fast make/unmake used by search
  makeRaw(m) {
    const B = this.board;
    const piece = B[m.from], captured = B[m.to];
    const u = { m, piece, captured, castle: { ...this.castle }, ep: this.ep, half: this.half, epCap: null, rook: null };
    B[m.to] = m.promo ? (this.turn === 'w' ? m.promo.toUpperCase() : m.promo) : piece;
    B[m.from] = null;
    const T = piece.toUpperCase();
    if (T === 'P' && m.to === this.ep) {
      const capSq = m.to + (this.turn === 'w' ? 8 : -8);
      u.epCap = [capSq, B[capSq]];
      B[capSq] = null;
    }
    if (T === 'K' && Math.abs(m.to - m.from) === 2) {
      const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
      u.rook = [rf, rt];
      B[rt] = B[rf];
      B[rf] = null;
    }
    this.ep = T === 'P' && Math.abs(m.to - m.from) === 16 ? (m.to + m.from) / 2 : -1;
    if (T === 'K') { if (this.turn === 'w') { this.castle.K = this.castle.Q = false; } else { this.castle.k = this.castle.q = false; } }
    for (const [s, k] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === s || m.to === s) this.castle[k] = false;
    this.half = T === 'P' || captured || u.epCap ? 0 : this.half + 1;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    return u;
  }

  unmakeRaw(u) {
    const B = this.board, m = u.m;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    B[m.from] = u.piece;
    B[m.to] = u.captured;
    if (u.epCap) B[u.epCap[0]] = u.epCap[1];
    if (u.rook) { B[u.rook[0]] = B[u.rook[1]]; B[u.rook[1]] = null; }
    this.castle = u.castle;
    this.ep = u.ep;
    this.half = u.half;
  }

  /** Play a move given as "e2e4" or "e7e8q". Returns the move info or null. */
  play(uci) {
    if (typeof uci !== 'string' || uci.length < 4) return null;
    const from = sq(uci.slice(0, 2)), to = sq(uci.slice(2, 4)), promo = uci[4] || undefined;
    const mv = this.moves().find((m) => m.from === from && m.to === to && (m.promo || undefined) === (promo || (m.promo ? 'q' : undefined)));
    if (!mv) return null;
    const captured = this.board[to] || (this.board[from]?.toUpperCase() === 'P' && to === this.ep ? (this.turn === 'w' ? 'p' : 'P') : null);
    const san = this.toSan(mv);
    this.makeRaw(mv);
    this.ply++;
    this.history.push({ uci: name(mv.from) + name(mv.to) + (mv.promo || ''), san, captured });
    this.notePosition();
    return { ...mv, captured, san };
  }

  toSan(m) {
    const p = this.board[m.from].toUpperCase();
    if (p === 'K' && Math.abs(m.to - m.from) === 2) return m.to > m.from ? 'O-O' : 'O-O-O';
    const cap = this.board[m.to] || (p === 'P' && m.to === this.ep);
    let s = p === 'P' ? (cap ? FILES[m.from % 8] : '') : p;
    if (p !== 'P') {
      const others = this.moves().filter((o) => o.to === m.to && o.from !== m.from && this.board[o.from] === this.board[m.from]);
      if (others.length) s += others.some((o) => o.from % 8 === m.from % 8) ? name(m.from)[1] : FILES[m.from % 8];
    }
    s += (cap ? 'x' : '') + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    const u = this.makeRaw(m);
    const check = this.inCheck(), mate = check && !this.moves().length;
    this.unmakeRaw(u);
    return s + (mate ? '#' : check ? '+' : '');
  }

  /** null while playing, else { winner: 'w'|'b'|null, reason } */
  result() {
    const moves = this.moves();
    if (!moves.length) return this.inCheck() ? { winner: this.turn === 'w' ? 'b' : 'w', reason: 'Checkmate' } : { winner: null, reason: 'Stalemate' };
    if (this.half >= 100) return { winner: null, reason: '50-move rule' };
    if ((this.positions.get(this.key()) || 0) >= 3) return { winner: null, reason: 'Threefold repetition' };
    const pieces = this.board.filter(Boolean).map((p) => p.toUpperCase()).sort().join('');
    if (['KK', 'BKK', 'KKN'].includes(pieces)) return { winner: null, reason: 'Insufficient material' };
    if (this.ply >= 400) return { winner: null, reason: 'Move limit' };
    return null;
  }

  material(color) {
    const V = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
    return this.board.reduce((s, p) => s + (p && colorOf(p) === color ? V[p.toUpperCase()] : 0), 0);
  }
}

// ---------------------------------------------------------------- AI
const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
// piece-square tables from White's perspective (index 0 = a8)
const PST = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

// king in the endgame: walk to the centre
const K_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

export function evaluate(g) {
  let s = 0, npW = 0, npB = 0, wk = -1, bk = -1;
  for (let i = 0; i < 64; i++) {
    const p = g.board[i];
    if (!p) continue;
    const T = p.toUpperCase();
    if (T === 'K') { if (p === 'K') wk = i; else bk = i; continue; }
    if (isWhite(p)) { s += VAL[T] + PST[T][i]; if (T !== 'P') npW += VAL[T]; }
    else { s -= VAL[T] + PST[T][(7 - Math.floor(i / 8)) * 8 + (i % 8)]; if (T !== 'P') npB += VAL[T]; }
  }
  // king safety in the middlegame, activity in the endgame (blended by material)
  const phase = Math.min(1, (npW + npB) / 3200);
  const kw = (k, white) => { const j = white ? k : (7 - Math.floor(k / 8)) * 8 + (k % 8); return phase * PST.K[j] + (1 - phase) * K_END[j]; };
  if (wk >= 0) s += kw(wk, true);
  if (bk >= 0) s -= kw(bk, false);
  // mop-up: the side that is clearly ahead herds the enemy king to the edge
  const diff = (npW - npB);
  if (wk >= 0 && bk >= 0 && Math.abs(diff) >= 300 && Math.min(npW, npB) <= 330) {
    const loser = diff > 0 ? bk : wk, winner = diff > 0 ? wk : bk;
    const lr = Math.floor(loser / 8), lc = loser % 8;
    const centre = Math.max(3 - lr, lr - 4) + Math.max(3 - lc, lc - 4);
    const dist = Math.abs(lr - Math.floor(winner / 8)) + Math.abs(lc - (winner % 8));
    const bonus = 10 * centre + 4 * (14 - dist);
    s += diff > 0 ? bonus : -bonus;
  }
  return g.turn === 'w' ? s : -s;
}

function ordered(g, moves) {
  return moves
    .map((m) => ({ m, s: (g.board[m.to] ? VAL[g.board[m.to].toUpperCase()] * 10 - VAL[g.board[m.from].toUpperCase()] : 0) + (m.promo ? 800 : 0) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

const MATE = 100000;

// A position that already happened in the game (or a 50-move draw) scores 0,
// so a winning side avoids repetitions and a losing side looks for them.
function isDrawn(g, ply) {
  if (g.half >= 100) return true;
  return ply <= 4 && g.half >= 4 && (g.positions.get(g.key()) || 0) >= 1;
}

function search(g, depth, alpha, beta, budget, ply) {
  if (budget.stop) return 0;
  if (++budget.n > budget.max) { budget.stop = true; return 0; }
  if (ply > 0 && isDrawn(g, ply)) return 0;
  const me = g.turn, opp = me === 'w' ? 'b' : 'w';
  const check = g.attacked(g.kingSq(me), opp);
  if (check && ply < 14) depth++; // never stop looking while in check (sees mates on the horizon)
  if (depth <= 0) return quiesce(g, alpha, beta, budget, 6);
  let legal = 0;
  for (const m of ordered(g, g.pseudoMoves())) {
    const u = g.makeRaw(m);
    if (g.attacked(g.kingSq(me), opp)) { g.unmakeRaw(u); continue; }
    legal++;
    const v = -search(g, depth - 1, -beta, -alpha, budget, ply + 1);
    g.unmakeRaw(u);
    if (budget.stop) return 0;
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  if (!legal) return check ? -(MATE - ply) : 0;
  return alpha;
}

function quiesce(g, alpha, beta, budget, depth) {
  if (budget.stop) return 0;
  if (++budget.n > budget.max * 1.5) { budget.stop = true; return 0; }
  const stand = evaluate(g);
  if (depth === 0 || stand >= beta) return stand >= beta ? beta : stand;
  if (stand > alpha) alpha = stand;
  const caps = g.pseudoMoves().filter((m) => g.board[m.to] || m.promo);
  for (const m of ordered(g, caps)) {
    const u = g.makeRaw(m);
    if (g.attacked(g.kingSq(g.turn === 'w' ? 'b' : 'w'), g.turn)) { g.unmakeRaw(u); continue; }
    const v = -quiesce(g, -beta, -alpha, budget, depth - 1);
    g.unmakeRaw(u);
    if (budget.stop) return 0;
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

/**
 * Iterative deepening at the root. Every depth is searched completely or not
 * at all, so running out of budget never mixes deep and shallow scores.
 * noise > 0 scores every move exactly (personality); noise 0 uses alpha-beta.
 */
function rootScores(g, depth, noise, max) {
  let moves = ordered(g, g.moves());
  if (!moves.length) return [];
  let done = null;
  const budget = { n: 0, max, stop: false };
  for (let d = 0; d <= depth; d++) {
    const scores = [];
    let alpha = -Infinity;
    for (const m of moves) {
      const u = g.makeRaw(m);
      let v;
      if (isDrawn(g, 1)) v = 0;
      else if (d === 0) v = -quiesce(g, -Infinity, Infinity, budget, 6);
      else v = -search(g, d - 1, -Infinity, noise ? Infinity : -alpha, budget, 1);
      g.unmakeRaw(u);
      if (budget.stop && d > 0) break;
      // without noise later moves get a bound only: a fail-low (v <= alpha) is
      // at best equal, so rank it just below the move that set alpha
      if (!noise && scores.length && v <= alpha) v = alpha - 1;
      scores.push({ m, v });
      if (!noise && v > alpha) alpha = v;
    }
    if (budget.stop && d > 0) break;
    budget.stop = false;
    done = scores;
    if (done.some((x) => x.v >= MATE - 50)) break; // a forced mate: no need to look further
    moves = done.slice().sort((x, y) => y.v - x.v).map((x) => x.m); // best first next time
  }
  return done;
}

function pick(scores, noise, rng) {
  let best = null, bestV = -Infinity;
  for (const { m, v: raw } of scores) {
    const mate = Math.abs(raw) >= MATE - 100;
    const v = raw + (noise && !mate ? (rng.next() - 0.5) * noise : rng.next() * 0.5);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best && { uci: name(best.from) + name(best.to) + (best.promo || ''), score: bestV };
}

export const LEVELS = [
  { name: 'Hermit Crab', depth: 0, noise: 220 },
  { name: 'Sea Turtle', depth: 1, noise: 90 },
  { name: 'Octopus', depth: 2, noise: 35 },
  { name: 'Shark', depth: 2, noise: 0 },
  { name: 'Kraken', depth: 3, noise: 0 },
];

// Levels for casual "play vs computer" (not replayed by the server, so the
// top levels may search deeper).
export const CASUAL_LEVELS = [
  { name: 'Beginner', elo: '~600', depth: 0, noise: 260, budget: 4000 },
  { name: 'Casual', elo: '~900', depth: 1, noise: 110, budget: 8000 },
  { name: 'Club', elo: '~1200', depth: 2, noise: 45, budget: 25000 },
  { name: 'Strong', elo: '~1500', depth: 3, noise: 15, budget: 50000 },
  { name: 'Expert', elo: '~1700', depth: 4, noise: 8, budget: 140000 },
  { name: 'Master', elo: '~1900', depth: 4, noise: 1, budget: 320000 },
];

/** Search the side to move's best move. Root alpha-beta; noise adds personality. */
export function searchMove(g, { depth, noise = 0, budget = 25000 }, rng) {
  return pick(rootScores(g, depth, noise, budget), noise, rng);
}

/** Casual AI move (uses any rng – e.g. Math.random based). */
export function casualMove(g, level, rng) {
  const L = CASUAL_LEVELS[Math.max(1, Math.min(level, CASUAL_LEVELS.length)) - 1];
  return searchMove(g.clone(), L, rng)?.uci || null;
}

/** Deterministic AI move for the side to move (ranked ladder, replayed by the server). */
export function aiMove(g, level, rng) {
  const L = LEVELS[Math.min(level, LEVELS.length) - 1];
  const noise = L.noise || (g.ply < 6 ? 30 : 0); // a little opening variety for the strongest bots
  return pick(rootScores(g, L.depth, noise, 25000), noise, rng)?.uci || null;
}

// ---------------------------------------------------------------- ladder sim (ranked)
// Score per game: win = 100 x level + bonus for speed + material edge;
// draw = 30 x level. A loss ends the run.
class ChessLadder {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.mySide = 'w';
    this.log = [];
    this.reset();
  }

  /** Choose your colour – only before your first move. */
  setColour(side) {
    if (this.log.length || (side !== 'w' && side !== 'b')) return false;
    this.log.push(['c', side]);
    this.mySide = side;
    this.reset();
    return true;
  }

  canMove() {
    return !this.over && this.game.turn === this.mySide;
  }

  reset() {
    this.rng = new Rng(this.seed);
    this.level = 1;
    this.points = 0;
    this.wins = 0;
    this.over = false;
    this.overReason = '';
    this.last = null; // last game result summary
    this.newGame();
  }
  get score() { return this.points; }
  get aiLevel() { return Math.min(this.level, LEVELS.length); }
  get opponent() { return LEVELS[this.aiLevel - 1].name + (this.level > LEVELS.length ? ` +${this.level - LEVELS.length}` : ''); }

  newGame() {
    this.game = new Chess();
    this.opening = null;
    // playing Black: the bot opens
    if (this.mySide === 'b') {
      const reply = aiMove(this.game, this.aiLevel, this.rng);
      this.opening = this.game.play(reply);
    }
  }

  /** Your move; the AI replies immediately. */
  move(uci) {
    if (this.over || this.game.turn !== this.mySide) return { ok: false };
    const mv = this.game.play(uci);
    if (!mv) return { ok: false };
    this.log.push(['m', uci]);
    const out = { ok: true, human: mv };
    if (!this.checkEnd(out)) {
      const reply = aiMove(this.game, this.aiLevel, this.rng);
      out.ai = this.game.play(reply);
      this.checkEnd(out);
    }
    return out;
  }

  checkEnd(out) {
    const r = this.game.result();
    if (!r) return false;
    const L = this.level;
    let gained = 0;
    const me = this.mySide, them = me === 'w' ? 'b' : 'w';
    if (r.winner === me) {
      gained = 100 * L + Math.max(0, 80 - this.game.ply) * 2 + Math.max(0, this.game.material(me) - this.game.material(them)) * 5;
      this.wins++;
      this.level++;
    } else if (r.winner === null) {
      gained = 30 * L;
    }
    this.points += gained;
    this.last = { ...r, gained, level: L };
    out.end = this.last;
    if (r.winner === them) {
      this.over = true;
      this.overReason = `${r.reason}! ${this.wins} win${this.wins === 1 ? '' : 's'} on the ladder`;
    } else {
      this.newGame();
    }
    return true;
  }

  resign() {
    if (this.over) return;
    this.log.push(['r']);
    this.over = true;
    this.overReason = `Resigned · ${this.wins} win${this.wins === 1 ? '' : 's'} on the ladder`;
  }
  quit() { this.resign(); }
}

function replay(seed, log) {
  const sim = new ChessLadder(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    if (a[0] === 'c') { if (!sim.setColour(a[1])) return { ok: false, reason: 'bad colour', sim }; }
    else if (a[0] === 'm') { if (!sim.move(a[1]).ok) return { ok: false, reason: 'illegal move', sim }; }
    else if (a[0] === 'r') sim.resign();
    else return { ok: false, reason: 'unknown action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'chess',
  title: 'Chess',
  icon: '♟️',
  tagline: 'Sea-creature bots, a ladder – or play a friend',
  color: ['#a1887f', '#263238'],
  maxLog: 3000,
  shellsPer: 15,
  milestone: 1000,
  board: true,
  create: (seed) => new ChessLadder(seed),
  replay,
};
export { ChessLadder };

// Block puzzle engine ("Block Party" mode). 8x8 board, three pieces per tray,
// fill rows/columns to clear them. Deterministic from a seed so daily
// boards are identical for everyone and the server can replay the log.

import { Rng } from './rng.js';

export const SIZE = 8;

// Pieces as lists of [r,c]. Weighted: small pieces are more common.
const BASE = [
  { w: 3, cells: [[0, 0]] },
  { w: 4, cells: [[0, 0], [0, 1]] },
  { w: 4, cells: [[0, 0], [1, 0]] },
  { w: 4, cells: [[0, 0], [0, 1], [0, 2]] },
  { w: 4, cells: [[0, 0], [1, 0], [2, 0]] },
  { w: 2, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { w: 2, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { w: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { w: 1, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { w: 5, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { w: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { w: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] },
  { w: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },
  // L shapes (4 rotations, small)
  { w: 2, cells: [[0, 0], [1, 0], [1, 1]] },
  { w: 2, cells: [[0, 1], [1, 0], [1, 1]] },
  { w: 2, cells: [[0, 0], [0, 1], [1, 0]] },
  { w: 2, cells: [[0, 0], [0, 1], [1, 1]] },
  // big L
  { w: 1, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
  { w: 1, cells: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { w: 1, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]] },
  { w: 1, cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  // T, S, Z
  { w: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { w: 2, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
  { w: 2, cells: [[0, 0], [1, 0], [1, 1], [2, 0]] },
  { w: 2, cells: [[0, 1], [1, 0], [1, 1], [2, 1]] },
  { w: 2, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { w: 2, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  { w: 2, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { w: 2, cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },
];
export const PIECES = BASE.map((p, i) => {
  const h = Math.max(...p.cells.map((c) => c[0])) + 1;
  const w = Math.max(...p.cells.map((c) => c[1])) + 1;
  return { id: i, weight: p.w, cells: p.cells, h, w };
});
const TOTAL_W = PIECES.reduce((s, p) => s + p.weight, 0);

/** Rescue levels: how many fish are trapped, how many pieces you get, and the tide. */
export function rescueLevel(n) {
  const fish = Math.min(8, 1 + Math.floor((n + 1) / 3));
  return { n, fish, pieces: 8 + fish * 4 - Math.floor(n / 3), tideEvery: n >= 5 ? Math.max(6, 10 - Math.floor((n - 5) / 4)) : 0, fill: Math.min(24, 10 + n) };
}
export const RESCUE_LEVELS = 20;
// a seed per level, picked so a sensible player's win rate falls from ~95% to ~45%
export const RESCUE_SEEDS = [7104, 7208, 7308, 7425, 7509, 7631, 7713, 7813, 7911, 8013, 8124, 8238, 8317, 8423, 8517, 8623, 8742, 8829, 8933, 9048];

export class BlockGame {
  /** rescue: level number – trapped fish to free by clearing their lines, within a piece budget */
  constructor({ seed, undos = 1, rescue = 0 }) {
    this.rng = new Rng(seed);
    this.board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(-1)); // -1 empty, else colour 0..5
    this.score = 0;
    this.combo = 0; // consecutive placements that cleared lines
    this.sinceClear = 0;
    this.linesCleared = 0;
    this.placed = 0;
    this.bestCombo = 0;
    this.undosLeft = undos;
    this.revived = false; // one revive per endless run (a rewarded ad in the Android app)
    this.state = 'playing';
    this.log = [];
    this.prev = null;
    this.tray = [];
    this.rescue = rescue ? rescueLevel(rescue) : null;
    this.fish = new Set(); // "r,c" of trapped fish (rescue mode)
    this.freed = 0;
    if (this.rescue) this.setupRescue();
    this.refill();
  }

  setupRescue() {
    const L = this.rescue;
    const fullLine = (r, c) => this.board[r].every((v) => v !== -1) || this.board.every((row) => row[c] !== -1);
    // each fish is stuck in a row (or column) that's mostly coral – finish it to set the fish free
    for (let k = 0; k < L.fish; k++) {
      const vertical = this.rng.next() < 0.4;
      const line = 2 + this.rng.int(SIZE - 2);
      const holes = 2 + this.rng.int(2) + (L.n > 10 ? 1 : 0);
      const gaps = new Set();
      while (gaps.size < holes) gaps.add(this.rng.int(SIZE));
      const cells = [];
      for (let i = 0; i < SIZE; i++) {
        const [r, c] = vertical ? [i, line] : [line, i];
        if (gaps.has(i) || this.board[r][c] !== -1) continue;
        this.board[r][c] = this.rng.int(6);
        if (fullLine(r, c)) { this.board[r][c] = -1; continue; }
        cells.push([r, c]);
      }
      const spot = cells.filter(([r, c]) => r >= 3 && !this.fish.has(`${r},${c}`));
      if (spot.length) { const [r, c] = spot[this.rng.int(spot.length)]; this.fish.add(`${r},${c}`); }
    }
    // a little loose coral in the way
    for (let k = 0; k < L.fill - 8; k++) {
      const r = 2 + this.rng.int(SIZE - 2), c = this.rng.int(SIZE);
      if (this.board[r][c] !== -1) continue;
      this.board[r][c] = this.rng.int(6);
      if (fullLine(r, c)) this.board[r][c] = -1;
    }
    this.piecesLeft = L.pieces;
  }

  /** The tide pushes a row of coral up from below; whatever was on the top row is washed away. */
  tidePush() {
    const top = this.board[0];
    let swept = 0;
    for (let c = 0; c < SIZE; c++) if (this.fish.delete(`0,${c}`)) swept++;
    const lostTop = top.some((v) => v !== -1);
    if (swept) { this.state = 'over'; this.overReason = 'A fish was swept away by the tide!'; }
    this.board.shift();
    const row = new Array(SIZE).fill(-1);
    for (let k = 0; k < 4; k++) row[this.rng.int(SIZE)] = this.rng.int(6);
    this.board.push(row);
    const moved = new Set();
    for (const f of this.fish) { const [r, c] = f.split(',').map(Number); if (r > 0) moved.add(`${r - 1},${c}`); }
    this.fish = moved;
    return lostTop;
  }

  randomPiece() {
    let x = this.rng.next() * TOTAL_W;
    let id = PIECES[PIECES.length - 1].id;
    for (const p of PIECES) {
      x -= p.weight;
      if (x < 0) { id = p.id; break; }
    }
    // endless gets tougher: after 200 pieces, small pieces are rarer
    if (!this.rescue && this.placed > 200 && PIECES[id].cells.length <= 2 && this.rng.next() < Math.min(0.6, (this.placed - 200) / 400)) return this.randomPiece();
    return id;
  }

  refill() {
    // Fair trays: the three pieces must be placeable one after another in
    // SOME order (line clears included). On a crowded board one piece is
    // nudged toward something that finishes a line – like a kind dealer.
    const filled = this.board.flat().filter((v) => v !== -1).length;
    let fallback = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const tray = [0, 1, 2].map(() => ({ piece: this.randomPiece(), color: this.rng.int(6) }));
      // the kind dealer helps less and less as an endless run goes on
      const kindness = this.rescue ? 0.5 : this.placed < 150 ? 0.5 : Math.max(0.08, 0.5 - (this.placed - 150) / 500);
      if (filled > 26 && this.rng.next() < kindness) {
        const helper = this.lineFinisher();
        if (helper !== null) tray[this.rng.int(3)].piece = helper;
      }
      if (!fallback && tray.some((t) => this.fitsAnywhere(t.piece))) fallback = tray;
      if (this.solvableTray(tray.map((t) => t.piece))) { this.tray = tray; return; }
    }
    this.tray = fallback || [0, 1, 2].map(() => ({ piece: this.randomPiece(), color: this.rng.int(6) }));
  }

  /** Can these pieces all be placed, in some order? (bounded search; clears included) */
  solvableTray(pieces) {
    let budget = 3000;
    const place = (board, pid, r0, c0) => {
      const b = board.map((row) => row.slice());
      for (const [dr, dc] of PIECES[pid].cells) b[r0 + dr][c0 + dc] = 0;
      const rows = [], cols = [];
      for (let r = 0; r < SIZE; r++) if (b[r].every((v) => v !== -1)) rows.push(r);
      for (let c = 0; c < SIZE; c++) if (b.every((row) => row[c] !== -1)) cols.push(c);
      for (const r of rows) b[r].fill(-1);
      for (const c of cols) for (let r = 0; r < SIZE; r++) b[r][c] = -1;
      return b;
    };
    const fits = (board, pid, r0, c0) => PIECES[pid].cells.every(([dr, dc]) => { const r = r0 + dr, c = c0 + dc; return r >= 0 && c >= 0 && r < SIZE && c < SIZE && board[r][c] === -1; });
    const go = (board, left) => {
      if (!left.length) return true;
      for (let i = 0; i < left.length; i++) {
        const pid = left[i], rest = left.filter((_, k) => k !== i);
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
          if (!fits(board, pid, r, c)) continue;
          if (--budget <= 0) return true; // too many options to doubt it
          if (go(place(board, pid, r, c), rest)) return true;
        }
      }
      return false;
    };
    return go(this.board, pieces);
  }

  /** A piece that fits and completes a row or column right now, if any. */
  lineFinisher() {
    const ids = PIECES.map((p) => p.id).filter((id) => PIECES[id].cells.length <= 5);
    for (let k = 0; k < ids.length; k++) {
      const pid = ids[(k + this.rng.int(ids.length)) % ids.length];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (!this.canPlace(pid, r, c)) continue;
        const cells = new Set(PIECES[pid].cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc));
        const full = (rr, cc) => this.board[rr][cc] !== -1 || cells.has(rr * SIZE + cc);
        for (let i = 0; i < SIZE; i++) {
          if ([...Array(SIZE).keys()].every((j) => full(i, j)) || [...Array(SIZE).keys()].every((j) => full(j, i))) return pid;
        }
      }
    }
    return null;
  }

  canPlace(pieceId, r0, c0) {
    for (const [dr, dc] of PIECES[pieceId].cells) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= SIZE || c >= SIZE || this.board[r][c] !== -1) return false;
    }
    return true;
  }

  fitsAnywhere(pieceId) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.canPlace(pieceId, r, c)) return true;
    return false;
  }

  saveState() {
    return JSON.stringify({
      board: this.board, score: this.score, combo: this.combo, sinceClear: this.sinceClear,
      linesCleared: this.linesCleared, placed: this.placed, bestCombo: this.bestCombo,
      tray: this.tray, rng: this.rng.s, state: this.state, fish: [...this.fish], freed: this.freed, piecesLeft: this.piecesLeft,
    });
  }

  loadState(json) {
    const s = JSON.parse(json);
    Object.assign(this, {
      board: s.board, score: s.score, combo: s.combo, sinceClear: s.sinceClear,
      linesCleared: s.linesCleared, placed: s.placed, bestCombo: s.bestCombo, tray: s.tray, state: s.state,
      fish: new Set(s.fish || []), freed: s.freed || 0, piecesLeft: s.piecesLeft,
    });
    this.rng.s = s.rng;
  }

  /** Place tray slot `slot` with its top-left at (r0,c0). */
  place(slot, r0, c0) {
    if (this.state !== 'playing') return { ok: false };
    const t = this.tray[slot];
    if (!t || !this.canPlace(t.piece, r0, c0)) return { ok: false };
    this.prev = this.saveState();
    this.log.push(['p', slot, r0, c0]);

    const cells = PIECES[t.piece].cells;
    for (const [dr, dc] of cells) this.board[r0 + dr][c0 + dc] = t.color;
    this.tray[slot] = null;
    this.placed++;
    let points = cells.length;

    const rows = [], cols = [];
    for (let r = 0; r < SIZE; r++) if (this.board[r].every((v) => v !== -1)) rows.push(r);
    for (let c = 0; c < SIZE; c++) if (this.board.every((row) => row[c] !== -1)) cols.push(c);
    const lines = rows.length + cols.length;
    const clearedCells = [];
    let freedNow = [];
    if (lines) {
      for (const r of rows) for (let c = 0; c < SIZE; c++) clearedCells.push([r, c, this.board[r][c]]);
      for (const c of cols) for (let r = 0; r < SIZE; r++) if (!rows.includes(r)) clearedCells.push([r, c, this.board[r][c]]);
      for (const r of rows) for (let c = 0; c < SIZE; c++) this.board[r][c] = -1;
      for (const c of cols) for (let r = 0; r < SIZE; r++) this.board[r][c] = -1;
      // rescue: fish in a cleared line swim free
      for (const f of [...this.fish]) { const [fr, fc] = f.split(',').map(Number); if (rows.includes(fr) || cols.includes(fc)) { this.fish.delete(f); freedNow.push([fr, fc]); } }
      this.freed += freedNow.length;
      points += freedNow.length * 50;
      this.combo = Math.min(8, this.sinceClear <= 3 ? this.combo + 1 : 1); // combos top out at x8
      this.sinceClear = 0;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.linesCleared += lines;
      // multi-line bonus grows fast; combo multiplies
      points += 10 * lines * lines * this.combo;
    } else {
      this.sinceClear++;
      if (this.sinceClear > 3) this.combo = 0;
    }
    const perfect = lines > 0 && this.board.every((row) => row.every((v) => v === -1));
    if (perfect) points += 300;
    this.score += points;

    let refilled = false, tide = false;
    if (this.rescue) {
      this.piecesLeft--;
      if (!this.fish.size) { this.state = 'won'; this.score += this.piecesLeft * 30; return { ok: true, rows, cols, lines, clearedCells, points, combo: lines ? this.combo : 0, perfect, refilled, freed: freedNow || [], won: true }; }
      if (this.rescue.tideEvery && this.placed % this.rescue.tideEvery === 0) { tide = true; this.tidePush(); }
      if (this.state === 'playing' && this.piecesLeft <= 0) { this.state = 'over'; this.overReason = 'Out of pieces'; }
    }
    if (this.tray.every((x) => x === null)) {
      this.refill();
      refilled = true;
    }
    if (this.state === 'playing' && !this.tray.some((x) => x && this.fitsAnywhere(x.piece))) this.state = 'over';
    return { ok: true, rows, cols, lines, clearedCells, points, combo: lines ? this.combo : 0, perfect, refilled, freed: freedNow || [], tide };
  }

  /** A run that ran out of room can be revived once (endless runs only, never rescue levels). */
  canRevive() {
    return this.state === 'over' && !this.revived && !this.rescue && this.placed > 0;
  }

  /**
   * Revive: the fullest rows and columns are cleared (no points) and a fresh tray is dealt, then play goes on.
   * Deterministic, so the server replays it exactly; it is the 'r' action in the log.
   */
  revive() {
    if (!this.canRevive()) return false;
    this.log.push(['r']);
    this.revived = true;
    this.prev = null;
    this.combo = 0;
    this.sinceClear = 0;
    const lines = [];
    for (let i = 0; i < SIZE; i++) {
      lines.push({ row: true, i, n: this.board[i].filter((v) => v !== -1).length });
      lines.push({ row: false, i, n: this.board.filter((r) => r[i] !== -1).length });
    }
    // fullest first; ties go to rows, then the lower index, so every replay picks the same lines
    lines.sort((a, b) => b.n - a.n || (a.row === b.row ? a.i - b.i : a.row ? -1 : 1));
    let used = 0;
    const clear = () => {
      const l = lines[used++];
      for (let k = 0; k < SIZE; k++) { if (l.row) this.board[l.i][k] = -1; else this.board[k][l.i] = -1; }
    };
    for (let k = 0; k < 4; k++) clear();
    this.refill();
    // make sure something fits: clear another line and deal again if not
    while (used < lines.length && !this.tray.some((x) => x && this.fitsAnywhere(x.piece))) { clear(); this.refill(); }
    this.state = this.tray.some((x) => x && this.fitsAnywhere(x.piece)) ? 'playing' : 'over';
    return this.state === 'playing';
  }

  undo() {
    if (!this.prev || this.undosLeft <= 0) return false;
    this.loadState(this.prev);
    this.prev = null;
    this.undosLeft--;
    this.log.push(['u']);
    return true;
  }
}

/** opts.noRevive: refuse a revive in the log (the Daily board is the same ad-free run for everyone). */
export function replayBlocks(seed, log, opts = {}) {
  const { noRevive, ...gameOpts } = opts;
  const g = new BlockGame({ seed, ...gameOpts });
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', game: g };
    if (a[0] === 'p') {
      if (!g.place(a[1], a[2], a[3]).ok) return { ok: false, reason: 'invalid placement', game: g };
    } else if (a[0] === 'u') {
      if (!g.undo()) return { ok: false, reason: 'invalid undo', game: g };
    } else if (a[0] === 'r') {
      if (noRevive || !g.revive()) return { ok: false, reason: 'invalid revive', game: g };
    } else return { ok: false, reason: 'unknown action', game: g };
  }
  return { ok: true, game: g };
}

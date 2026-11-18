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

export class BlockGame {
  constructor({ seed, undos = 1 }) {
    this.rng = new Rng(seed);
    this.board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(-1)); // -1 empty, else colour 0..5
    this.score = 0;
    this.combo = 0; // consecutive placements that cleared lines
    this.sinceClear = 0;
    this.linesCleared = 0;
    this.placed = 0;
    this.bestCombo = 0;
    this.undosLeft = undos;
    this.state = 'playing';
    this.log = [];
    this.prev = null;
    this.tray = [];
    this.refill();
  }

  randomPiece() {
    let x = this.rng.next() * TOTAL_W;
    for (const p of PIECES) {
      x -= p.weight;
      if (x < 0) return p.id;
    }
    return PIECES[PIECES.length - 1].id;
  }

  refill() {
    // Fair trays: the three pieces must be placeable one after another in
    // SOME order (line clears included). On a crowded board one piece is
    // nudged toward something that finishes a line – like a kind dealer.
    const filled = this.board.flat().filter((v) => v !== -1).length;
    let fallback = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const tray = [0, 1, 2].map(() => ({ piece: this.randomPiece(), color: this.rng.int(6) }));
      if (filled > 26 && this.rng.next() < 0.5) {
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
      tray: this.tray, rng: this.rng.s, state: this.state,
    });
  }

  loadState(json) {
    const s = JSON.parse(json);
    Object.assign(this, {
      board: s.board, score: s.score, combo: s.combo, sinceClear: s.sinceClear,
      linesCleared: s.linesCleared, placed: s.placed, bestCombo: s.bestCombo, tray: s.tray, state: s.state,
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
    if (lines) {
      for (const r of rows) for (let c = 0; c < SIZE; c++) clearedCells.push([r, c, this.board[r][c]]);
      for (const c of cols) for (let r = 0; r < SIZE; r++) if (!rows.includes(r)) clearedCells.push([r, c, this.board[r][c]]);
      for (const r of rows) for (let c = 0; c < SIZE; c++) this.board[r][c] = -1;
      for (const c of cols) for (let r = 0; r < SIZE; r++) this.board[r][c] = -1;
      this.combo = this.sinceClear <= 3 ? this.combo + 1 : 1;
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

    let refilled = false;
    if (this.tray.every((x) => x === null)) {
      this.refill();
      refilled = true;
    }
    if (!this.tray.some((x) => x && this.fitsAnywhere(x.piece))) this.state = 'over';
    return { ok: true, rows, cols, lines, clearedCells, points, combo: lines ? this.combo : 0, perfect, refilled };
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

export function replayBlocks(seed, log) {
  const g = new BlockGame({ seed });
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', game: g };
    if (a[0] === 'p') {
      if (!g.place(a[1], a[2], a[3]).ok) return { ok: false, reason: 'invalid placement', game: g };
    } else if (a[0] === 'u') {
      if (!g.undo()) return { ok: false, reason: 'invalid undo', game: g };
    } else return { ok: false, reason: 'unknown action', game: g };
  }
  return { ok: true, game: g };
}

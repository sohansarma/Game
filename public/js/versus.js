// Player-vs-player for board games (Chess, Ludo): pass & play on one device
// and asynchronous online matches with a short join code.
//
// Online model: a match is { code, game, seed, opts, host, guest }. Each
// player only ever writes their OWN list of moves; both clients rebuild the
// game by replaying the two lists in turn order through the same engine.
// Storage goes through api.matches (shared artifact database or Node server).

import { Chess, LEVELS } from './arcade/chess.js';
import { LudoGame, aiChoose, COLORS } from './arcade/ludo.js';
import { Rng } from './rng.js';

// ---------------------------------------------------------------- chess
export class ChessVersus {
  /** mySide: 'w' | 'b' | null (null = pass & play, both sides local) */
  constructor({ mySide = null, names = { w: 'White', b: 'Black' } } = {}) {
    this.game = new Chess();
    this.mySide = mySide;
    this.names = names;
    this.over = false;
    this.result = null;
    this.moves = []; // all moves in order (uci)
  }
  canMove() {
    return !this.over && (this.mySide === null || this.game.turn === this.mySide);
  }
  header() {
    if (this.over) return `${this.result.reason}${this.result.winner ? ` – ${this.names[this.result.winner]} wins` : ' – draw'}`;
    const who = this.names[this.game.turn];
    return this.mySide && this.game.turn !== this.mySide ? `Waiting for ${who}…` : `${who} to move${this.game.inCheck() ? ' – check!' : ''}`;
  }
  move(uci) {
    if (!this.canMove()) return { ok: false };
    return this.apply(uci);
  }
  apply(uci) {
    const mv = this.game.play(uci);
    if (!mv) return { ok: false };
    this.moves.push(uci);
    const out = { ok: true, human: mv };
    const r = this.game.result();
    if (r) { this.over = true; this.result = r; out.end = r; }
    return out;
  }
  resign(side = this.mySide || this.game.turn) {
    if (this.over) return;
    this.over = true;
    this.result = { winner: side === 'w' ? 'b' : 'w', reason: `${this.names[side]} resigned` };
  }
}

// ---------------------------------------------------------------- ludo
export class LudoVersus {
  /** seats: array of 4 'human' | 'ai' | null; mine: seat indexes controlled here (null = all humans local) */
  constructor({ seed, seats, mine = null, names = {} }) {
    this.rng = new Rng(seed);
    this.seats = seats;
    this.mine = mine;
    this.names = names;
    this.game = new LudoGame(this.rng, seats.map((s) => (s === 'ai' ? 'ai' : s ? 'human' : null)));
    this.over = false;
    this.moves = []; // [seat, token] in order
    this.pending = [];
    this.runBots();
  }
  label(seat) {
    return this.names[seat] || COLORS[seat][0].toUpperCase() + COLORS[seat].slice(1);
  }
  canMove() {
    if (this.over || this.game.over) return false;
    const t = this.game.turn;
    if (this.seats[t] === 'ai') return false;
    return this.mine === null || this.mine.includes(t);
  }
  turnLabel() {
    return this.mine && this.mine.length === 1 ? 'Your turn' : `${this.label(this.game.turn)}'s turn`;
  }
  waitLabel() {
    return this.over ? 'Game over' : `Waiting for ${this.label(this.game.turn)}…`;
  }
  runBots() {
    let guard = 0;
    while (!this.game.over && this.seats[this.game.turn] === 'ai' && guard++ < 2000) this.game.move(aiChoose(this.game, 0.6, this.rng));
    if (this.game.over) this.over = true;
  }
  move(t) {
    if (!this.canMove()) return { ok: false };
    return this.apply(this.game.turn, t);
  }
  apply(seat, t) {
    if (this.game.turn !== seat) return { ok: false };
    this.game.events = [];
    if (!this.game.move(t)) return { ok: false };
    this.moves.push([seat, t]);
    this.runBots();
    const out = { ok: true, events: this.game.events };
    if (this.game.over) { this.over = true; out.end = { places: this.places() }; }
    return out;
  }
  places() {
    return this.seats.map((s, i) => (s ? { seat: i, name: this.label(i), place: this.game.placeOf(i) } : null)).filter(Boolean).sort((a, b) => a.place - b.place);
  }
  resign() {
    this.over = true;
  }
}

// ---------------------------------------------------------------- online helpers
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode() {
  let s = '';
  const buf = crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(5)) : Array.from({ length: 5 }, () => Math.random() * 1e9);
  for (const n of buf) s += CODE_CHARS[n % CODE_CHARS.length];
  return s;
}
export const validCode = (c) => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(c);

/**
 * Rebuild an online match from both players' move lists.
 * match = { game, seed, opts, hostMoves, guestMoves }, me = 'host' | 'guest'
 */
export function rebuild(match, me) {
  if (match.game === 'chess') {
    const mySide = me === 'host' ? match.opts.hostSide : match.opts.hostSide === 'w' ? 'b' : 'w';
    const names = { [match.opts.hostSide]: match.hostName || 'Host', [match.opts.hostSide === 'w' ? 'b' : 'w']: match.guestName || 'Guest' };
    const v = new ChessVersus({ mySide, names });
    const lists = { [match.opts.hostSide]: [...(match.hostMoves || [])], [match.opts.hostSide === 'w' ? 'b' : 'w']: [...(match.guestMoves || [])] };
    for (let guard = 0; guard < 600 && !v.over; guard++) {
      const next = lists[v.game.turn].shift();
      if (!next) break;
      if (!v.apply(next).ok) break; // ignore anything illegal from the other side
    }
    if (!v.over && match.resigned) v.resign(match.resigned === 'host' ? match.opts.hostSide : match.opts.hostSide === 'w' ? 'b' : 'w');
    return v;
  }
  // ludo: host = red (0), guest = yellow (2); bots optional on green/blue
  const seats = ['human', match.opts.bots ? 'ai' : null, 'human', match.opts.bots ? 'ai' : null];
  const names = { 0: match.hostName || 'Host', 2: match.guestName || 'Guest' };
  const v = new LudoVersus({ seed: match.seed, seats, mine: [me === 'host' ? 0 : 2], names });
  const lists = { 0: [...(match.hostMoves || [])], 2: [...(match.guestMoves || [])] };
  for (let guard = 0; guard < 3000 && !v.over; guard++) {
    const seat = v.game.turn;
    const next = lists[seat]?.shift();
    if (next === undefined) break;
    if (!v.apply(seat, next).ok) break;
  }
  return v;
}

export function describe(match) {
  if (match.game === 'chess') return `♟️ Chess · host plays ${match.opts.hostSide === 'w' ? 'White' : 'Black'}`;
  return `🎲 Ludo · ${match.opts.bots ? '2 players + 2 bots' : '2 players'}`;
}

export { LEVELS };

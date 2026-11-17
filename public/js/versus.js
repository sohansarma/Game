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
  /** seats: 4 x 'human' | 'ai' | null; mine: seats controlled here (null = every human seat is local) */
  constructor({ seed, seats, mine = null, names = {}, first = null }) {
    this.rng = new Rng(seed);
    this.seats = seats;
    this.mine = mine;
    this.names = names;
    this.mySide = mine && mine.length === 1 ? mine[0] : undefined;
    this.game = new LudoGame(this.rng, seats.map((s) => (s === 'ai' ? 'ai' : s ? 'human' : null)), first ?? seats.findIndex((s) => s === 'human'));
    this.over = false;
    this.moves = []; // [seat, 'r' | token] in order
    this.runBots();
  }
  labelOf(seat) {
    if (this.names[seat]) return this.names[seat];
    const c = COLORS[seat][0].toUpperCase() + COLORS[seat].slice(1);
    return this.seats[seat] === 'ai' ? `${c} bot` : this.mine?.includes(seat) && this.mine.length === 1 ? 'You' : c;
  }
  isLocal(seat) {
    return this.seats[seat] === 'human' && (this.mine === null || this.mine.includes(seat));
  }
  myTurn() {
    return !this.over && !this.game.over && this.isLocal(this.game.turn);
  }
  canRoll() { return this.myTurn() && this.game.phase === 'roll'; }
  canMove() { return this.myTurn() && this.game.phase === 'move'; }
  runBots() {
    let guard = 0;
    while (!this.game.over && this.seats[this.game.turn] === 'ai' && guard++ < 20000) this.game.aiStep(0.6, this.rng);
    if (this.game.over) this.over = true;
  }
  roll() {
    if (!this.canRoll()) return { ok: false };
    return this.apply(this.game.turn, 'r');
  }
  move(t) {
    if (!this.canMove()) return { ok: false };
    return this.apply(this.game.turn, t);
  }
  apply(seat, a) {
    const g = this.game;
    if (g.over || g.turn !== seat) return { ok: false };
    g.events = [];
    if (a === 'r') { if (g.phase !== 'roll' || g.doRoll() === null) return { ok: false }; }
    else if (g.phase !== 'move' || !g.move(a)) return { ok: false };
    this.moves.push([seat, a]);
    this.runBots();
    const out = { ok: true, events: g.events };
    if (g.over) { this.over = true; out.end = { places: this.places() }; }
    return out;
  }
  places() {
    return this.seats.map((s, i) => (s ? { seat: i, name: this.labelOf(i), place: this.game.placeOf(i) } : null)).filter(Boolean).sort((a, b) => a.place - b.place);
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
  // ludo: host picks a colour, guest sits opposite; bots optionally fill the other seats
  const hs = Number.isInteger(match.opts.hostColour) ? match.opts.hostColour : 0;
  const gs = (hs + 2) % 4;
  const seats = [0, 1, 2, 3].map((i) => (i === hs || i === gs ? 'human' : match.opts.bots ? 'ai' : null));
  const names = { [hs]: match.hostName || 'Host', [gs]: match.guestName || 'Guest' };
  const v = new LudoVersus({ seed: match.seed, seats, mine: [me === 'host' ? hs : gs], names, first: hs });
  const lists = { [hs]: [...(match.hostMoves || [])], [gs]: [...(match.guestMoves || [])] };
  for (let guard = 0; guard < 6000 && !v.over; guard++) {
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

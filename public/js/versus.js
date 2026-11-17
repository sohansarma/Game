// Player-vs-player for board games (Chess, Ludo): pass & play on one device
// and asynchronous online matches with a short join code.
//
// Online model: a match is { code, game, seed, opts, host, guest }. Each
// player only ever writes their OWN list of moves; both clients rebuild the
// game by replaying the two lists in turn order through the same engine.
// Storage goes through api.matches (shared artifact database or Node server).

import { Chess, LEVELS, CASUAL_LEVELS, casualMove, searchMove } from './arcade/chess.js';
import { LudoGame, aiChoose, COLORS } from './arcade/ludo.js';
import { Rng } from './rng.js';

// ---------------------------------------------------------------- chess
/** Chess clock: base minutes + increment seconds. Real time, per side. */
export class ChessClock {
  constructor(minutes, increment = 0) {
    this.left = { w: minutes * 60000, b: minutes * 60000 };
    this.inc = increment * 1000;
    this.running = null;
    this.since = 0;
  }
  start(side) {
    this.running = side;
    this.since = performance.now();
  }
  /** Stop the mover's clock, add the increment, start the other side. */
  switchAfter(side) {
    this.sync();
    this.left[side] += this.inc;
    this.start(side === 'w' ? 'b' : 'w');
  }
  sync() {
    if (!this.running) return;
    const now = performance.now();
    this.left[this.running] = Math.max(0, this.left[this.running] - (now - this.since));
    this.since = now;
  }
  stop() {
    this.sync();
    this.running = null;
  }
  get(side) {
    if (this.running === side) return Math.max(0, this.left[side] - (performance.now() - this.since));
    return this.left[side];
  }
  /** Returns the side that ran out of time, if any. */
  flagged() {
    if (this.running && this.get(this.running) <= 0) return this.running;
    return null;
  }
}

export const TIME_CONTROLS = [
  { id: 'none', label: 'No clock' },
  { id: '3+2', label: '⚡ 3 min + 2 s', min: 3, inc: 2 },
  { id: '5+0', label: '🔥 5 min', min: 5, inc: 0 },
  { id: '10+0', label: '⏱️ 10 min', min: 10, inc: 0 },
  { id: '15+10', label: '🐢 15 min + 10 s', min: 15, inc: 10 },
];
const makeClock = (tc) => {
  const t = TIME_CONTROLS.find((x) => x.id === tc);
  return t && t.min ? new ChessClock(t.min, t.inc) : null;
};

/** Shared base for 2-player-ish chess controllers. */
class ChessBase {
  constructor({ names, clock }) {
    this.game = new Chess();
    this.names = names;
    this.over = false;
    this.result = null;
    this.moves = [];
    this.clock = makeClock(clock);
  }
  apply(uci) {
    const mover = this.game.turn;
    const mv = this.game.play(uci);
    if (!mv) return { ok: false };
    this.moves.push(uci);
    if (this.clock) {
      if (!this.clock.running && this.moves.length >= 1) this.clock.start(this.game.turn); // clocks start after White's first move
      else this.clock.switchAfter(mover);
    }
    const out = { ok: true, human: mv };
    const r = this.game.result();
    if (r) this.finish(r, out);
    return out;
  }
  finish(r, out) {
    this.over = true;
    this.result = r;
    this.clock?.stop();
    if (out) out.end = r;
  }
  /** Called by the view every frame. */
  tick() {
    if (this.over || !this.clock) return null;
    const side = this.clock.flagged();
    if (!side) return null;
    const other = side === 'w' ? 'b' : 'w';
    // flag falls – but a lone king can't win on time
    const onlyKing = this.game.board.filter((p) => p && (p === p.toUpperCase() ? 'w' : 'b') === other).length === 1;
    const r = onlyKing ? { winner: null, reason: 'Timeout vs insufficient material' } : { winner: other, reason: `${this.names[side]} ran out of time` };
    this.finish(r);
    return r;
  }
  resign(side = this.mySide || this.game.turn) {
    if (this.over) return;
    this.finish({ winner: side === 'w' ? 'b' : 'w', reason: `${this.names[side]} resigned` });
  }
  agreeDraw() {
    if (this.over) return;
    this.finish({ winner: null, reason: 'Draw by agreement' });
  }
  /** Rebuild the game from the first n moves (for takebacks). */
  truncate(n) {
    const keep = this.moves.slice(0, n);
    this.game = new Chess();
    this.moves = [];
    for (const m of keep) { this.game.play(m); this.moves.push(m); }
  }
}

export class ChessVersus extends ChessBase {
  /** mySide: 'w' | 'b' | null (null = pass & play, both sides local) */
  constructor({ mySide = null, names = { w: 'White', b: 'Black' }, clock = 'none', autoFlip = false } = {}) {
    super({ names, clock });
    this.mySide = mySide;
    this.autoFlip = autoFlip;
    this.local = mySide === null;
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
}

/** You vs the computer – casual, with clocks, takebacks, hints and draw offers. */
export class ChessCasual extends ChessBase {
  constructor({ mySide = 'w', level = 3, clock = 'none', name = 'You' }) {
    const bot = CASUAL_LEVELS[level - 1];
    const them = mySide === 'w' ? 'b' : 'w';
    super({ names: { [mySide]: name, [them]: `${bot.name} bot` }, clock });
    this.mySide = mySide;
    this.level = level;
    this.rng = { next: Math.random };
    this.takebacks = 0;
    this.hintsUsed = 0;
  }
  get botSide() {
    return this.mySide === 'w' ? 'b' : 'w';
  }
  canMove() {
    return !this.over && this.game.turn === this.mySide;
  }
  botToMove() {
    return !this.over && this.game.turn === this.botSide;
  }
  header() {
    return `vs ${this.names[this.botSide]} (${CASUAL_LEVELS[this.level - 1].elo})`;
  }
  move(uci) {
    if (!this.canMove()) return { ok: false };
    return this.apply(uci);
  }
  /** The computer's reply (call after the human move has been shown). */
  botMove() {
    if (!this.botToMove()) return null;
    const uci = casualMove(this.game, this.level, this.rng);
    if (!uci) return null;
    const res = this.apply(uci);
    return res.ok ? { ...res, ai: res.human } : null;
  }
  canTakeback() {
    return !this.over && this.moves.length >= (this.mySide === 'w' ? 1 : 2) && this.game.turn === this.mySide;
  }
  takeback() {
    if (!this.canTakeback()) return false;
    // undo your last move and the bot's reply
    const n = this.moves.length - (this.game.turn === this.mySide ? 2 : 1);
    this.truncate(Math.max(this.mySide === 'b' ? 1 : 0, n));
    this.takebacks++;
    if (this.clock) { this.clock.stop(); if (this.moves.length) this.clock.start(this.game.turn); }
    return true;
  }
  hint() {
    if (!this.canMove()) return null;
    this.hintsUsed++;
    return casualMove(this.game, Math.min(6, Math.max(4, this.level)), this.rng);
  }
  /** The bot accepts a draw when it isn't better and the game is old enough. */
  offerDraw() {
    if (this.over || this.moves.length < 20) return false;
    const g = this.game.clone();
    if (g.turn !== this.botSide) g.turn = this.botSide;
    const best = searchMove(g, { depth: 1, budget: 4000 }, this.rng);
    const accept = !best || best.score <= 60;
    if (accept) this.agreeDraw();
    return accept;
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

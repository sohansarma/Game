// Ludo – rules engine + deterministic AI. Pure (no DOM).
//
// Real-table flow: on your turn you ROLL the dice (an explicit action),
// then MOVE one token. Token progress p: -1 = in base, 0..50 = main track
// (relative to its own start), 51..55 = home column, 56 = home.
// Rules: a 6 brings a token out; a 6, a capture or getting a token home
// earns another roll; three 6s in a row forfeit the turn; landing on an
// opponent outside a safe square sends it back to base; exact roll to finish.
//
// Ranked mode "Ludo League": you pick your colour and face three bots.
// Placing 1st or 2nd advances you to a smarter table; 3rd or 4th ends the run.

import { Rng } from '../rng.js';

export const COLORS = ['red', 'green', 'yellow', 'blue'];
export const START = [0, 13, 26, 39];
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME = 56;

export const abs = (player, p) => (p < 0 || p > 50 ? -1 : (START[player] + p) % 52);

/**
 * House rules (all off = classic):
 *  master  – a token may only enter its home column after its player has captured once
 *  joda    – two of your tokens on one square form a block that can't be captured
 *  quick   – each player starts with one token already out
 *  teams   – 2v2: seats 0+2 vs 1+3; partners never capture each other; a team wins when both are home
 */
export const DEFAULT_RULES = { master: false, joda: false, quick: false, teams: false };

export class LudoGame {
  /** players: 4 controller tags ('human' | 'ai' | 'remote') or null for an empty seat */
  constructor(rng, players = ['human', 'ai', 'ai', 'ai'], first = null, rules = DEFAULT_RULES) {
    this.rules = { ...DEFAULT_RULES, ...(rules || {}) };
    this.rng = rng;
    this.players = players;
    this.tokens = players.map(() => [this.rules.quick ? 0 : -1, -1, -1, -1]);
    this.turn = first !== null && players[first] ? first : players.findIndex(Boolean);
    this.phase = 'roll'; // 'roll' | 'move'
    this.roll = 0;
    this.sixes = 0;
    this.finished = []; // order in which players got all 4 home
    this.captures = players.map(() => 0);
    this.over = false;
    this.events = [];
  }

  active(i) {
    return !!this.players[i] && !this.finished.includes(i);
  }

  legal(player = this.turn, roll = this.roll) {
    if (this.phase !== 'move') return [];
    const out = [];
    this.tokens[player].forEach((p, t) => {
      if (p === HOME) return;
      if (p < 0) { if (roll === 6) out.push(t); return; }
      if (p + roll > HOME) return;
      // master rule: no entering the home column before your first capture
      if (this.rules.master && p <= 50 && p + roll > 50 && !this.captures[player]) return;
      out.push(t);
    });
    return out;
  }

  /** The current player throws the dice. */
  doRoll() {
    if (this.over || this.phase !== 'roll') return null;
    const pl = this.turn;
    this.roll = 1 + this.rng.int(6);
    this.events.push({ kind: 'roll', player: pl, value: this.roll });
    this.sixes = this.roll === 6 ? this.sixes + 1 : 0; // only 6s in a row count
    if (this.sixes >= 3) {
      this.events.push({ kind: 'three6', player: pl });
      this.passTurn();
      return this.roll;
    }
    this.phase = 'move';
    if (!this.legal().length) {
      this.events.push({ kind: 'pass', player: pl });
      // a 6 with nothing to move still earns the extra roll
      if (this.roll === 6) this.phase = 'roll';
      else this.passTurn();
    }
    return this.roll;
  }

  /** Move token t of the current player with the rolled value. */
  move(t) {
    const pl = this.turn;
    if (this.over || this.phase !== 'move' || !this.legal().includes(t)) return false;
    const from = this.tokens[pl][t];
    const to = from < 0 ? 0 : from + this.roll;
    this.tokens[pl][t] = to;
    const ev = { kind: 'move', player: pl, token: t, from, to, captured: [] };
    let bonus = this.roll === 6;
    const a = abs(pl, to);
    if (a >= 0 && !SAFE.has(a)) {
      this.players.forEach((_, op) => {
        if (op === pl || !this.players[op] || this.partners(op, pl)) return;
        const here = this.tokens[op].filter((q) => abs(op, q) === a).length;
        if (this.rules.joda && here >= 2) return; // a block can't be captured
        this.tokens[op].forEach((q, k) => {
          if (abs(op, q) === a) {
            this.tokens[op][k] = -1;
            ev.captured.push({ player: op, token: k, from: q });
            this.captures[pl]++;
            bonus = true;
          }
        });
      });
    }
    if (to === HOME) bonus = true;
    this.events.push(ev);
    if (this.tokens[pl].every((p) => p === HOME)) {
      this.finished.push(pl);
      this.events.push({ kind: 'finish', player: pl, place: this.finished.length });
      if (this.checkOver()) return true;
      this.passTurn();
      return true;
    }
    if (bonus) {
      this.phase = 'roll';
      this.events.push({ kind: 'bonus', player: pl });
    } else this.passTurn();
    return true;
  }

  /** In team play seats 0+2 and 1+3 are partners. */
  partners(a, b) {
    return !!this.rules.teams && a !== b && a % 2 === b % 2;
  }

  passTurn() {
    this.sixes = 0;
    this.phase = 'roll';
    if (this.checkOver()) return;
    for (let i = 1; i <= 4; i++) {
      const n = (this.turn + i) % 4;
      if (this.active(n)) { this.turn = n; break; }
    }
    this.events.push({ kind: 'turn', player: this.turn });
  }

  checkOver() {
    if (this.rules.teams) {
      for (const team of [[0, 2], [1, 3]]) {
        if (team.every((i) => !this.players[i] || this.finished.includes(i))) {
          this.winningTeam = team;
          this.over = true;
          this.phase = 'over';
          return true;
        }
      }
    }
    const remaining = this.players.map((p, i) => (p && !this.finished.includes(i) ? i : -1)).filter((i) => i >= 0);
    if (remaining.length <= 1) {
      if (remaining.length === 1) this.finished.push(remaining[0]);
      this.over = true;
      this.phase = 'over';
      return true;
    }
    return false;
  }

  progress(player) {
    return this.tokens[player].reduce((s, p) => s + Math.max(0, p + 1), 0);
  }

  /** Place (1-4) of a player – finished order first, then by progress. */
  placeOf(player) {
    const i = this.finished.indexOf(player);
    if (i >= 0) return i + 1;
    const rest = this.players.map((p, k) => k).filter((k) => this.players[k] && !this.finished.includes(k)).sort((a, b) => this.progress(b) - this.progress(a));
    return this.finished.length + rest.indexOf(player) + 1;
  }

  /** Plays one full AI action (roll or move). Returns false if it's not an AI's turn. */
  aiStep(skill, rng) {
    if (this.over || this.players[this.turn] !== 'ai') return false;
    if (this.phase === 'roll') this.doRoll();
    else this.move(aiChoose(this, skill, rng));
    return true;
  }
}

/** Deterministic AI choice of which token to move. skill 0..1 */
export function aiChoose(g, skill, rng) {
  const pl = g.turn, legal = g.legal();
  if (legal.length === 1) return legal[0];
  const danger = (a) => {
    if (a < 0 || SAFE.has(a)) return 0;
    let d = 0;
    g.players.forEach((_, op) => {
      if (op === pl || !g.active(op) || g.partners?.(op, pl)) return;
      for (const q of g.tokens[op]) {
        const qa = abs(op, q);
        if (qa < 0) continue;
        const dist = (a - qa + 52) % 52;
        // only a token that can still travel that far along the main track
        if (dist >= 1 && dist <= 6 && q + dist <= 50) d++;
      }
    });
    return d;
  };
  let best = legal[0], bestV = -Infinity;
  for (const t of legal) {
    const from = g.tokens[pl][t];
    const to = from < 0 ? 0 : from + g.roll;
    const a = abs(pl, to);
    let v = 0;
    if (from < 0) v += 40;
    if (to === HOME) v += 60;
    if (to > 50 && from <= 50) v += 30;
    if (a >= 0 && !SAFE.has(a)) {
      g.players.forEach((_, op) => {
        if (op !== pl && g.players[op] && !g.partners?.(op, pl)) for (const q of g.tokens[op]) if (abs(op, q) === a) v += 80 + q;
      });
    }
    if (SAFE.has(a)) v += 15;
    v -= danger(a) * 25 * skill;
    v += danger(abs(pl, from)) * 20 * skill;
    v += to * 0.5;
    v += (rng.next() - 0.5) * (1 - skill) * 120;
    if (v > bestV) { bestV = v; best = t; }
  }
  return best;
}

// ---------------------------------------------------------------- ranked league
const PLACE_POINTS = [0, 300, 120, 40, 10];

class LudoLeague {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.mySide = 0; // chosen colour (seat)
    this.log = [];
    this.reset();
  }

  reset() {
    this.rng = new Rng(this.seed);
    this.match = 0;
    this.points = 0;
    this.wins = 0;
    this.over = false;
    this.overReason = '';
    this.last = null;
    this.newMatch();
  }

  get score() { return this.points; }
  get skill() { return Math.min(0.95, 0.35 + this.match * 0.12); }
  get opponent() { return `Table ${this.match} · bots ${Math.round(this.skill * 100)}% smart`; }
  get game() { return this.g; }

  /** Pick your colour – only before the first roll. */
  setColour(seat) {
    if (this.log.length || !Number.isInteger(seat) || seat < 0 || seat > 3) return false;
    this.log.push(['c', seat]);
    this.mySide = seat;
    this.reset();
    return true;
  }

  newMatch() {
    this.match++;
    const seats = [0, 1, 2, 3].map((i) => (i === this.mySide ? 'human' : 'ai'));
    // you always start the first table; afterwards the seat after you does
    this.g = new LudoGame(this.rng, seats, this.match === 1 ? this.mySide : (this.mySide + 1) % 4);
    this.runAI();
  }

  runAI() {
    const g = this.g;
    let guard = 0;
    while (!g.over && g.players[g.turn] === 'ai' && guard++ < 20000) g.aiStep(this.skill, this.rng);
    // once you've finished, the rest doesn't change your place
    if (!g.over && g.finished.includes(this.mySide)) { g.over = true; g.phase = 'over'; }
  }

  myTurn() {
    return !this.over && !this.g.over && this.g.turn === this.mySide;
  }
  canRoll() {
    return this.myTurn() && this.g.phase === 'roll';
  }
  canMove() {
    return this.myTurn() && this.g.phase === 'move';
  }

  roll() {
    if (!this.canRoll()) return { ok: false };
    const g = this.g;
    g.events = [];
    g.doRoll();
    this.log.push(['r']);
    this.runAI();
    return this.finishAction();
  }

  move(t) {
    if (!this.canMove()) return { ok: false };
    const g = this.g;
    g.events = [];
    if (!g.move(t)) return { ok: false };
    this.log.push(['m', t]);
    this.runAI();
    return this.finishAction();
  }

  finishAction() {
    const g = this.g;
    const out = { ok: true, events: g.events };
    if (g.over || g.finished.includes(this.mySide)) {
      out.end = this.endMatch();
      // the next table may open with bot moves: show those too
      if (this.g !== g) out.next = this.g.events.slice();
    }
    return out;
  }

  endMatch() {
    const g = this.g;
    const me = this.mySide;
    const place = g.placeOf(me);
    const home = g.tokens[me].filter((p) => p === HOME).length;
    const gained = PLACE_POINTS[place] * this.match + g.captures[me] * 15 + home * 5;
    this.points += gained;
    const end = { place, gained, match: this.match, winner: place === 1 ? me : null, reason: ['', '1st place', '2nd place', '3rd place', '4th place'][place] };
    this.last = end;
    if (place <= 2) {
      if (place === 1) this.wins++;
      this.newMatch();
    } else {
      this.over = true;
      this.overReason = `Finished ${end.reason} at table ${this.match}`;
    }
    return end;
  }

  resign() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
    this.overReason = `Left the league after ${this.match - 1} table${this.match === 2 ? '' : 's'}`;
  }
  quit() { this.resign(); }
}

function replay(seed, log) {
  const sim = new LudoLeague(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    let ok;
    if (a[0] === 'c') ok = sim.setColour(a[1]);
    else if (a[0] === 'r') ok = sim.roll().ok;
    else if (a[0] === 'm') ok = sim.move(a[1]).ok;
    else if (a[0] === 'q') { sim.resign(); ok = true; }
    else return { ok: false, reason: 'unknown action', sim };
    if (!ok) return { ok: false, reason: 'illegal action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'ludo',
  title: 'Ludo',
  icon: '🎲',
  tagline: 'Roll, race & capture – vs bots or friends',
  color: ['#ef5350', '#1a237e'],
  maxLog: 6000,
  shellsPer: 20,
  milestone: 1500,
  board: true,
  create: (seed) => new LudoLeague(seed),
  replay,
};
export { LudoLeague };

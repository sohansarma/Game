// Ludo – rules engine + deterministic AI. Pure (no DOM).
//
// 4 colours, 4 tokens each. Token progress p: -1 = in base, 0..50 = main
// track (relative to its own start), 51..55 = home column, 56 = home.
// Roll a 6 to leave base; a 6 (or a capture, or getting a token home) gives
// another roll; three 6s in a row forfeit the turn. Landing on an opponent
// outside a safe square sends it back to base.
//
// Ranked mode "Ludo League": you (red) vs three AI. Placing 1st or 2nd
// advances you to a tougher match; 3rd or 4th ends the run.

import { Rng } from '../rng.js';

export const COLORS = ['red', 'green', 'yellow', 'blue'];
export const START = [0, 13, 26, 39];
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME = 56;

export const abs = (player, p) => (p < 0 || p > 50 ? -1 : (START[player] + p) % 52);

export class LudoGame {
  /** players: array of 4 controller tags ('human' | 'ai' | 'remote' | null for empty seat) */
  constructor(rng, players = ['human', 'ai', 'ai', 'ai']) {
    this.rng = rng;
    this.players = players;
    this.tokens = players.map(() => [-1, -1, -1, -1]);
    this.turn = players.findIndex(Boolean);
    this.roll = 0;
    this.sixes = 0;
    this.finished = []; // order in which players got all 4 home
    this.captures = players.map(() => 0);
    this.over = false;
    this.events = [];
    this.newRoll();
    this.skipStuck();
  }

  // a roll with no legal move passes automatically
  skipStuck() {
    let guard = 0;
    while (!this.over && !this.legal().length && guard++ < 200) {
      this.events.push({ kind: 'pass', player: this.turn });
      this.nextPlayer();
      this.newRoll();
    }
  }

  active(i) {
    return !!this.players[i] && !this.finished.includes(i);
  }

  newRoll() {
    this.roll = 1 + this.rng.int(6);
    this.events.push({ kind: 'roll', player: this.turn, value: this.roll });
  }

  legal(player = this.turn, roll = this.roll) {
    const out = [];
    this.tokens[player].forEach((p, t) => {
      if (p === HOME) return;
      if (p < 0) { if (roll === 6) out.push(t); return; }
      if (p + roll <= HOME) out.push(t);
    });
    return out;
  }

  /** Move token t of the current player with the current roll. */
  move(t) {
    const pl = this.turn;
    if (this.over || !this.legal().includes(t)) return false;
    const from = this.tokens[pl][t];
    const to = from < 0 ? 0 : from + this.roll;
    this.tokens[pl][t] = to;
    const ev = { kind: 'move', player: pl, token: t, from, to, captured: [] };
    let bonus = this.roll === 6;
    const a = abs(pl, to);
    if (a >= 0 && !SAFE.has(a)) {
      this.players.forEach((_, op) => {
        if (op === pl || !this.players[op]) return;
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
      bonus = false;
    }
    this.advance(bonus);
    return true;
  }

  advance(bonus) {
    if (this.checkOver()) return;
    if (bonus && this.active(this.turn)) {
      if (this.roll === 6) this.sixes++;
      if (this.sixes >= 3) { this.sixes = 0; this.nextPlayer(); }
    } else {
      this.nextPlayer();
    }
    this.newRoll();
    this.skipStuck();
  }

  nextPlayer() {
    this.sixes = 0;
    for (let i = 1; i <= 4; i++) {
      const n = (this.turn + i) % 4;
      if (this.active(n)) { this.turn = n; return; }
    }
  }

  checkOver() {
    const remaining = this.players.map((p, i) => (p && !this.finished.includes(i) ? i : -1)).filter((i) => i >= 0);
    if (remaining.length <= 1) {
      if (remaining.length === 1) this.finished.push(remaining[0]);
      this.over = true;
      return true;
    }
    return false;
  }

  progress(player) {
    return this.tokens[player].reduce((s, p) => s + Math.max(0, p + 1), 0);
  }

  /** Place (1-4) of a player once the game is over or they finished. */
  placeOf(player) {
    const i = this.finished.indexOf(player);
    if (i >= 0) return i + 1;
    // rank unfinished players by progress
    const rest = this.players.map((p, k) => k).filter((k) => this.players[k] && !this.finished.includes(k)).sort((a, b) => this.progress(b) - this.progress(a));
    return this.finished.length + rest.indexOf(player) + 1;
  }
}

/** Deterministic AI choice. skill 0..1 (higher = smarter). */
export function aiChoose(g, skill, rng) {
  const pl = g.turn, legal = g.legal();
  if (legal.length === 1) return legal[0];
  const danger = (a) => {
    if (a < 0 || SAFE.has(a)) return 0;
    let d = 0;
    g.players.forEach((_, op) => {
      if (op === pl || !g.active(op)) return;
      for (const q of g.tokens[op]) {
        const qa = abs(op, q);
        if (qa < 0) continue;
        const dist = (a - qa + 52) % 52;
        if (dist >= 1 && dist <= 6) d++;
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
    if (to > 50 && from <= 50) v += 30; // into the home column
    if (a >= 0 && !SAFE.has(a)) {
      g.players.forEach((_, op) => {
        if (op !== pl && g.players[op]) for (const q of g.tokens[op]) if (abs(op, q) === a) v += 80 + q;
      });
    }
    if (SAFE.has(a)) v += 15;
    v -= danger(a) * 25 * skill;
    v += danger(abs(pl, from)) * 20 * skill; // escaping
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
    this.rng = new Rng(seed);
    this.match = 0;
    this.points = 0;
    this.wins = 0;
    this.over = false;
    this.overReason = '';
    this.log = [];
    this.mySide = 0;
    this.last = null;
    this.newMatch();
  }
  get score() { return this.points; }
  get skill() { return Math.min(0.95, 0.35 + this.match * 0.12); }
  get opponent() { return `Match ${this.match} · bots ${Math.round(this.skill * 100)}% smart`; }
  get game() { return this.g; }

  newMatch() {
    this.match++;
    this.g = new LudoGame(this.rng, ['human', 'ai', 'ai', 'ai']);
    this.runAI();
  }

  runAI() {
    const g = this.g;
    let guard = 0;
    while (!g.over && g.players[g.turn] === 'ai' && guard++ < 5000) g.move(aiChoose(g, this.skill, this.rng));
    // the human finished, so the rest doesn't matter for scoring
    if (!g.over && g.finished.includes(0)) g.over = true;
  }

  canMove() {
    return !this.over && !this.g.over && this.g.turn === 0;
  }

  /** Human moves token t. Returns { ok, events, end? }. */
  move(t) {
    if (!this.canMove()) return { ok: false };
    const g = this.g;
    g.events = [];
    if (!g.move(t)) return { ok: false };
    this.log.push(['m', t]);
    this.runAI();
    const out = { ok: true, events: g.events };
    if (g.over || g.finished.includes(0)) out.end = this.endMatch();
    return out;
  }

  endMatch() {
    const g = this.g;
    const place = g.placeOf(0);
    const home = g.tokens[0].filter((p) => p === HOME).length;
    const gained = PLACE_POINTS[place] * this.match + g.captures[0] * 15 + home * 5;
    this.points += gained;
    const end = { place, gained, match: this.match, winner: place === 1 ? 0 : null, reason: ['', '1st place', '2nd place', '3rd place', '4th place'][place] };
    this.last = end;
    if (place <= 2) {
      if (place === 1) this.wins++;
      this.newMatch();
    } else {
      this.over = true;
      this.overReason = `Finished ${end.reason} in match ${this.match}`;
    }
    return end;
  }

  resign() {
    if (this.over) return;
    this.log.push(['r']);
    this.over = true;
    this.overReason = `Left the league after ${this.match - 1} match${this.match === 2 ? '' : 'es'}`;
  }
  quit() { this.resign(); }
}

function replay(seed, log) {
  const sim = new LudoLeague(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    if (sim.over) return { ok: false, reason: 'input after game over', sim };
    if (a[0] === 'm') { if (!sim.move(a[1]).ok) return { ok: false, reason: 'illegal move', sim }; }
    else if (a[0] === 'r') sim.resign();
    else return { ok: false, reason: 'unknown action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'ludo',
  title: 'Ludo League',
  icon: '🎲',
  tagline: 'Race your tokens home – vs bots or friends',
  color: ['#ef5350', '#1a237e'],
  maxLog: 4000,
  shellsPer: 20,
  milestone: 1500,
  board: true,
  create: (seed) => new LudoLeague(seed),
  replay,
};
export { LudoLeague };

// Simple bots that play each arcade game through its public sim API.
// They exist to test determinism and server verification, not to play well.
import { T, SHOP_ITEMS } from '../public/js/arcade/miner.js';
import { solve as sortSolve } from '../public/js/arcade/sort.js';

import { name as chessSq } from '../public/js/arcade/chess.js';

import { aiChoose as ludoAI } from '../public/js/arcade/ludo.js';

export const BOTS = {
  ludo(sim, rng) {
    if (!sim.log.length) sim.setColour(rng.int(4));
    if (sim.canRoll()) sim.roll();
    else if (sim.canMove()) sim.move(ludoAI(sim.game, 0.7, rng));
    else sim.resign();
  },
  // Random legal moves (it will lose to the ladder, which is the point).
  chess(sim, rng) {
    const ms = sim.game.moves();
    const m = rng.pick(ms);
    if (!m || sim.game.ply > 200) { sim.resign(); return; }
    sim.move(chessSq(m.from) + chessSq(m.to) + (m.promo || ''));
  },
  // Taps crabs after a human-ish reaction delay; sometimes misses or hits a jelly.
  catch(sim, rng) {
    if (!sim.started) { sim.start(); return; }
    for (let i = 0; i < sim.holes.length; i++) {
      const h = sim.holes[i];
      if (h && sim.tick - h.born > 14 + rng.int(20) && (h.kind !== 'jelly' || rng.next() < 0.05)) { sim.tap(i); break; }
    }
    if (rng.next() < 0.004) sim.tap(rng.int(12));
    sim.step();
  },
  // Follows the ball with an error that grows over time, so it eventually misses.
  breaker(sim, rng) {
    if (sim.attached) { if (sim.tick % 30 === 0) sim.launch(); }
    else if (sim.tick % 4 === 0) sim.input(sim.bx + (rng.next() - 0.5) * (6 + sim.tick / 400));
    sim.step();
    if (sim.tick > 60 * 60 * 15) sim.quit();
  },
  sort(sim, rng) {
    if (!sim._plan || !sim._plan.length || sim._planLevel !== sim.level) {
      sim._plan = sim.level <= 4 ? sortSolve(sim.tubes, 20000) : null;
      sim._planLevel = sim.level;
      if (!sim._plan) { // too hard for the bot: random legal pours until oxygen runs out
        const legal = [];
        for (let a = 0; a < sim.tubes.length; a++) for (let b = 0; b < sim.tubes.length; b++) if (sim.pourCount(a, b)) legal.push([a, b]);
        if (!legal.length) { if (!sim.extraTube().ok) sim.quit(); return; }
        const [a, b] = rng.pick(legal);
        sim.pour(a, b);
        return;
      }
    }
    const [a, b] = sim._plan.shift();
    if (!sim.pour(a, b).ok) sim._plan = null;
  },
  // Drops when roughly lined up; gets sloppier over time so runs end.
  stack(sim, rng) {
    if (!sim.started) { sim.drop(); return; }
    const top = sim.tower[sim.tower.length - 1];
    const err = Math.abs(sim.cur.x - top.x);
    if (err < 1 + sim.floors * 0.15 + rng.next() * 3 || sim.tick > 50000) sim.drop();
    else sim.step();
    if (sim.tick > 60000) sim.quit();
  },
  // Corner strategy with a little randomness.
  merge(sim, rng) {
    const order = rng.next() < 0.85 ? ['d', 'l', 'r', 'u'] : rng.shuffle(['d', 'l', 'r', 'u']);
    for (const d of order) if (sim.move(d).ok) return;
    sim.quit();
  },
  // Heads for food, avoiding walls/rocks/body; sometimes picks randomly.
  serpent(sim, rng) {
    if (!sim.started) sim.start();
    if (sim.tick + 1 >= sim.nextMove && !sim.queue.length) {
      const [hx, hy] = sim.body[0];
      const D = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
      const safe = Object.keys(D).filter((d) => {
        const x = hx + D[d][0], y = hy + D[d][1];
        return x >= 0 && y >= 0 && x < 15 && y < 19 && !sim.occupied(x, y);
      });
      const target = sim.pearl ? [sim.pearl.x, sim.pearl.y] : sim.food;
      const dist = (d) => Math.abs(hx + D[d][0] - target[0]) + Math.abs(hy + D[d][1] - target[1]);
      const pick = rng.next() < 0.1 ? rng.pick(safe.length ? safe : ['u']) : safe.sort((a, b) => dist(a) - dist(b))[0];
      if (pick && pick !== sim.dir) sim.turn(pick);
    }
    sim.step();
    if (sim.tick > 60 * 60 * 10) sim.quit();
  },
  // Flaps toward the next gap, with occasional mistakes so it eventually loses.
  puffer(sim, rng) {
    const next = sim.pipes.find((p) => p.x + 16 > 25) || sim.pipes[0];
    if (!sim.started || (sim.y > next.gy + 5 && sim.vy > 0 && rng.next() < 0.97)) sim.flap();
    sim.step();
    if (sim.tick > 20000) sim.quit();
  },
  miner(sim, rng) {
    if (sim.atShop()) {
      if (sim.gold >= SHOP_ITEMS.pick.price(sim) && sim.pick < 2) { sim.buy('pick'); return; }
      if (sim.gold >= SHOP_ITEMS.energy.price(sim)) { sim.buy('energy'); return; }
    }
    const order = rng.next() < 0.7 ? ['d', 'l', 'r'] : rng.shuffle(['d', 'l', 'r']);
    for (const d of order) {
      const dd = { l: [-1, 0], r: [1, 0], d: [0, 1] }[d];
      if (sim.get(sim.x + dd[0], sim.y + dd[1]) === T.LAVA && rng.next() < 0.8) continue;
      if (sim.turn > 400) break;
      if (sim.move(d).ok) return;
    }
    if (sim.bombs > 0 && sim.bomb().ok) return;
    sim.quit();
  },
};

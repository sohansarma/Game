// Simple bots that play each arcade game through its public sim API.
// They exist to test determinism and server verification, not to play well.
import { T, SHOP_ITEMS } from '../public/js/arcade/miner.js';

export const BOTS = {
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

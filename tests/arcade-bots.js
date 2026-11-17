// Simple bots that play each arcade game through its public sim API.
// They exist to test determinism and server verification, not to play well.
import { T, SHOP_ITEMS } from '../public/js/arcade/miner.js';

export const BOTS = {
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

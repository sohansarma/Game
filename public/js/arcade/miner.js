// Deep Miner – a turn-based digging game. Pure & deterministic.
//
// You start at the surface with limited energy. Each dig costs energy based
// on the block's hardness (cheaper with a better pickaxe). Ores add gold,
// energy crystals refill you, TNT blasts a 3x3 area, lava hurts. Every 25
// rows there is a shop ledge where gold buys energy, pickaxe upgrades and
// bombs. The run ends when you're out of energy (or have no affordable move).
// Ore goes into your cargo bag, which holds only so much: ore you dig with a
// full bag is left behind. Cargo is banked (and becomes spendable gold) at
// each shop ledge or back at the surface. A sonar ping from the shop shows
// ores through the dark for 40 turns.
// Score = gold earned (banked + still in the bag; spending doesn't reduce
// it) + 10 x deepest row.

import { Rng, hashString } from '../rng.js';

export const W = 9;
export const SHOP_EVERY = 25;

// block types
export const T = {
  AIR: 0, DIRT: 1, STONE: 2, HARD: 3, COPPER: 4, SILVER: 5, GOLD: 6, EMERALD: 7, DIAMOND: 8,
  CRYSTAL: 9, TNT: 10, CHEST: 11, LAVA: 12, SHOP: 13, BEDROCK: 14,
};
export const INFO = {
  [T.DIRT]: { hard: 1, gold: 0, name: 'Dirt' },
  [T.STONE]: { hard: 2, gold: 0, name: 'Stone' },
  [T.HARD]: { hard: 4, gold: 0, name: 'Granite' },
  [T.COPPER]: { hard: 1, gold: 10, name: 'Copper' },
  [T.SILVER]: { hard: 2, gold: 25, name: 'Silver' },
  [T.GOLD]: { hard: 2, gold: 60, name: 'Gold' },
  [T.EMERALD]: { hard: 3, gold: 150, name: 'Emerald' },
  [T.DIAMOND]: { hard: 4, gold: 400, name: 'Diamond' },
  [T.CRYSTAL]: { hard: 1, gold: 0, energy: 18, name: 'Energy crystal' },
  [T.TNT]: { hard: 1, gold: 0, name: 'TNT' },
  [T.CHEST]: { hard: 1, gold: 0, name: 'Chest' },
  [T.LAVA]: { hard: 1, gold: 0, hurt: 20, name: 'Lava' },
  [T.SHOP]: { hard: 99, name: 'Shop ledge' },
  [T.BEDROCK]: { hard: 99, name: 'Bedrock' },
};

export const SHOP_ITEMS = {
  energy: { name: 'Energy +40', price: () => 90 },
  pick: { name: 'Pickaxe upgrade', price: (sim) => 150 + sim.pick * 150 },
  bomb: { name: 'Bomb', price: () => 70 },
  bag: { name: 'Bigger bag +250', price: (sim) => 100 + sim.bagUps * 100 },
  sonar: { name: 'Sonar ping', price: () => 50 },
};
export const BAG_START = 300;

const START_ENERGY = 70;

class MinerSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rows = new Map();
    this.x = Math.floor(W / 2);
    this.y = 0;
    this.energy = START_ENERGY;
    this.maxEnergy = START_ENERGY;
    this.gold = 0; // balance
    this.earned = 0; // total gold ever earned
    this.maxDepth = 0;
    this.pick = 0; // pickaxe level
    this.bombs = 1;
    this.cargo = 0;
    this.cargoCap = BAG_START;
    this.bagUps = 0;
    this.sonarUntil = 0;
    this.over = false;
    this.log = [];
    this.events = [];
    this.turn = 0;
    this.visitedShops = new Set();
    this.set(this.x, 0, T.AIR);
  }

  get score() {
    return this.earned + this.cargo + this.maxDepth * 10;
  }
  get sonar() {
    return this.turn < this.sonarUntil;
  }

  bank() {
    if (!this.cargo) return;
    this.gold += this.cargo;
    this.earned += this.cargo;
    this.events.push({ kind: 'bank', amount: this.cargo });
    this.cargo = 0;
  }

  // ---- world generation (each row depends only on seed + row index) ----
  row(y) {
    let r = this.rows.get(y);
    if (r) return r;
    r = genRow(this.seed, y);
    this.rows.set(y, r);
    return r;
  }
  get(x, y) {
    if (x < 0 || x >= W || y < 0) return T.BEDROCK;
    return this.row(y)[x];
  }
  set(x, y, v) {
    this.row(y)[x] = v;
  }

  digCost(type) {
    const info = INFO[type];
    if (!info || info.hard >= 99) return Infinity;
    const base = info.hard * 2;
    return Math.max(1, Math.round(base * Math.pow(0.75, this.pick)));
  }

  atShop() {
    return this.y > 0 && this.y % SHOP_EVERY === 0;
  }

  // ---- actions ----
  /** Move/dig in a direction: 'l' | 'r' | 'd' | 'u'. */
  move(dir) {
    if (this.over) return { ok: false };
    const d = { l: [-1, 0], r: [1, 0], d: [0, 1], u: [0, -1] }[dir];
    if (!d) return { ok: false };
    const nx = this.x + d[0], ny = this.y + d[1];
    const t = this.get(nx, ny);
    if (t === T.BEDROCK || t === T.SHOP) return { ok: false };
    // can only go up through air (climbing), costs 1
    if (dir === 'u' && t !== T.AIR) return { ok: false };
    this.events = [];
    let cost = t === T.AIR ? (dir === 'u' ? 1 : 0) : this.digCost(t);
    if (cost > this.energy) return { ok: false };
    this.log.push(['m', dir]);
    this.turn++;
    this.energy -= cost;
    if (t !== T.AIR) this.collect(nx, ny, t);
    this.x = nx;
    this.y = ny;
    this.fall();
    this.afterTurn();
    return { ok: true, events: this.events };
  }

  collect(x, y, t) {
    const info = INFO[t];
    this.set(x, y, T.AIR);
    this.events.push({ kind: 'dig', x, y, t });
    if (info.gold) this.addGold(info.gold, x, y);
    if (info.energy) this.addEnergy(info.energy, x, y);
    if (info.hurt) {
      this.energy = Math.max(0, this.energy - info.hurt);
      this.events.push({ kind: 'hurt', x, y, amount: info.hurt });
    }
    if (t === T.TNT) this.blast(x, y, 1, 0.5);
    if (t === T.CHEST) {
      const rng = new Rng(hashString(`${this.seed}:chest:${x}:${y}`));
      if (rng.next() < 0.5) this.addEnergy(25 + rng.int(20), x, y);
      else this.addGold(80 + rng.int(220) + y * 2, x, y);
    }
  }

  blast(cx, cy, rad, oreShare) {
    this.events.push({ kind: 'boom', x: cx, y: cy, rad });
    for (let y = cy - rad; y <= cy + rad; y++)
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (x === this.x && y === this.y) continue;
        const t = this.get(x, y);
        if (t === T.AIR || t === T.BEDROCK || t === T.SHOP || y < 1) continue;
        const info = INFO[t];
        this.set(x, y, T.AIR);
        this.events.push({ kind: 'dig', x, y, t });
        if (info.gold) this.addGold(Math.round(info.gold * oreShare), x, y);
        if (info.energy) this.addEnergy(Math.round(info.energy * oreShare), x, y);
        if (t === T.TNT) this.blast(x, y, 1, oreShare);
      }
  }

  addGold(n, x, y) {
    const room = this.cargoCap - this.cargo;
    const take = Math.min(room, n);
    if (take > 0) {
      this.cargo += take;
      this.events.push({ kind: 'gold', x, y, amount: take });
    }
    if (take < n) this.events.push({ kind: 'full', x, y, amount: n - take });
  }
  addEnergy(n, x, y) {
    this.energy = Math.min(this.maxEnergy + 60, this.energy + n);
    this.events.push({ kind: 'energy', x, y, amount: n });
  }

  fall() {
    let fell = 0;
    while (this.get(this.x, this.y + 1) === T.AIR) {
      this.y++;
      fell++;
    }
    if (fell) this.events.push({ kind: 'fall', rows: fell });
  }

  /** Buy at a shop ledge: 'energy' | 'pick' | 'bomb'. */
  buy(item) {
    if (this.over || !this.atShop()) return { ok: false };
    const it = SHOP_ITEMS[item];
    if (!it) return { ok: false };
    const price = it.price(this);
    if (this.gold < price) return { ok: false };
    this.log.push(['b', item]);
    this.events = [];
    this.gold -= price;
    if (item === 'energy') { this.energy += 40; this.maxEnergy += 10; }
    if (item === 'pick') this.pick++;
    if (item === 'bomb') this.bombs++;
    if (item === 'bag') { this.cargoCap += 250; this.bagUps++; }
    if (item === 'sonar') this.sonarUntil = this.turn + 40;
    this.events.push({ kind: 'buy', item });
    return { ok: true, events: this.events };
  }

  /** Use a bomb: clears the 3x3 around you (no energy cost), full ore value. */
  bomb() {
    if (this.over || this.bombs <= 0) return { ok: false };
    this.log.push(['x']);
    this.events = [];
    this.bombs--;
    this.turn++;
    this.blast(this.x, this.y, 1, 1);
    this.fall();
    this.afterTurn();
    return { ok: true, events: this.events };
  }

  afterTurn() {
    if (this.y > this.maxDepth) {
      for (let s = Math.floor(this.maxDepth / SHOP_EVERY) + 1; s * SHOP_EVERY <= this.y; s++) {
        this.events.push({ kind: 'depth', y: s * SHOP_EVERY });
      }
      this.maxDepth = this.y;
    }
    if (this.atShop() || this.y === 0) this.bank();
    if (this.atShop() && !this.visitedShops.has(this.y)) {
      this.visitedShops.add(this.y);
      this.events.push({ kind: 'shop' });
    }
    if (!this.canMove()) {
      this.over = true;
      this.events.push({ kind: 'over' });
    }
  }

  // The run continues while some solid block next to the open area you can
  // reach is affordable to dig (or you have a bomb / can shop).
  canMove() {
    if (this.bombs > 0) return true;
    if (this.atShop() && Object.values(SHOP_ITEMS).some((it) => it.price(this) <= this.gold)) return true;
    const seen = new Set([`${this.x},${this.y}`]);
    const queue = [[this.x, this.y]];
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const t = this.get(nx, ny);
        if (t === T.BEDROCK || t === T.SHOP) continue;
        if (t === T.AIR) {
          const k = `${nx},${ny}`;
          if (!seen.has(k) && seen.size < 400) { seen.add(k); queue.push([nx, ny]); }
        } else if (dy !== -1 && this.digCost(t) <= this.energy) return true;
      }
    }
    return false;
  }

  /** Player gives up / cashes out (ends the run). */
  quit() {
    if (this.over) return;
    this.log.push(['q']);
    this.over = true;
  }
}

function genRow(seed, y) {
  const r = new Array(W).fill(T.DIRT);
  if (y === 0) return new Array(W).fill(T.AIR);
  if (y % SHOP_EVERY === 0) {
    // shop ledge: solid ledge with one gap you dig through
    const rng = new Rng(hashString(`${seed}:shop:${y}`));
    const gap = rng.int(W);
    for (let x = 0; x < W; x++) r[x] = x === gap ? T.DIRT : T.SHOP;
    return r;
  }
  const rng = new Rng(hashString(`${seed}:row:${y}`));
  const depth = y;
  for (let x = 0; x < W; x++) {
    const p = rng.next();
    // base rock gets harder with depth
    const stoneP = Math.min(0.55, 0.12 + depth * 0.006);
    const hardP = Math.max(0, Math.min(0.3, (depth - 30) * 0.004));
    let t = T.DIRT;
    if (p < hardP) t = T.HARD;
    else if (p < hardP + stoneP) t = T.STONE;
    // features
    const q = rng.next();
    const lavaP = depth > 20 ? Math.min(0.06, (depth - 20) * 0.001) : 0;
    const table = [
      [T.CRYSTAL, Math.max(0.035, 0.07 - depth * 0.0004)],
      [T.COPPER, 0.07],
      [T.SILVER, depth > 5 ? 0.045 : 0],
      [T.GOLD, depth > 15 ? Math.min(0.04, 0.01 + depth * 0.0006) : 0],
      [T.EMERALD, depth > 35 ? Math.min(0.025, (depth - 35) * 0.0007) : 0],
      [T.DIAMOND, depth > 60 ? Math.min(0.015, (depth - 60) * 0.0004) : 0],
      [T.TNT, depth > 8 ? 0.018 : 0],
      [T.CHEST, depth > 10 ? 0.006 : 0],
      [T.LAVA, lavaP],
    ];
    let acc = 0;
    for (const [type, prob] of table) {
      acc += prob;
      if (q < acc) { t = type; break; }
    }
    r[x] = t;
  }
  return r;
}

function replay(seed, log) {
  const sim = new MinerSim(seed);
  for (const a of log) {
    if (!Array.isArray(a)) return { ok: false, reason: 'bad action', sim };
    let res;
    if (a[0] === 'm') res = sim.move(a[1]);
    else if (a[0] === 'b') res = sim.buy(a[1]);
    else if (a[0] === 'x') res = sim.bomb();
    else if (a[0] === 'q') { sim.quit(); res = { ok: true }; }
    else return { ok: false, reason: 'unknown action', sim };
    if (!res.ok) return { ok: false, reason: 'invalid action', sim };
  }
  return { ok: true, sim };
}

export default {
  id: 'miner',
  title: 'Deep Miner',
  icon: '⛏️',
  tagline: 'Dig deep, grab gems, don’t run dry',
  color: ['#c58b4c', '#3b2414'],
  maxLog: 6000,
  shellsPer: 120, // 1 shell per this many points
  milestone: 2000,
  create: (seed) => new MinerSim(seed),
  replay,
};
export { MinerSim };

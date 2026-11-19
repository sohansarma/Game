// Tide Pool – the player's own cozy cove. Shells earned in ANY game buy decor;
// some pieces can only be found by playing particular games. Each spot in the
// scene shows one item (swap freely between the ones you own). A cozier cove
// earns a bigger daily treasure. Pip naps in whatever bed you give him.
//
// Save: d.pool = { owned: { itemId: 1 }, placed: { slotId: itemId } }

export const SLOTS = [
  { id: 'sky', name: 'Sky', x: 0.5, y: 0.13, size: 0.11 },
  { id: 'rockL', name: 'Left rock', x: 0.15, y: 0.4, size: 0.1 },
  { id: 'rockR', name: 'Right rock', x: 0.85, y: 0.4, size: 0.1 },
  { id: 'plantL', name: 'Left plant', x: 0.07, y: 0.66, size: 0.14 },
  { id: 'plantR', name: 'Right plant', x: 0.93, y: 0.66, size: 0.14 },
  { id: 'pool', name: 'In the pool', x: 0.53, y: 0.63, size: 0.08 },
  { id: 'bed', name: "Pip's bed", x: 0.27, y: 0.8, size: 0.13 },
  { id: 'light', name: 'Light', x: 0.73, y: 0.78, size: 0.1 },
  { id: 'seat', name: 'Seat', x: 0.86, y: 0.9, size: 0.12 },
  { id: 'rug', name: 'Rug', x: 0.5, y: 0.92, size: 0.12 },
];

// comfort: how much cozier the cove feels · glow: lights up at night · find: unlocked by playing
export const ITEMS = [
  // sky
  { id: 'kite', slot: 'sky', icon: '🪁', name: 'Kite', price: 60, comfort: 2 },
  { id: 'balloon', slot: 'sky', icon: '🎈', name: 'Balloon', price: 40, comfort: 1 },
  { id: 'gulls', slot: 'sky', icon: '🕊️', name: 'Dove', price: 120, comfort: 3 },
  { id: 'lanterns', slot: 'sky', icon: '🏮', name: 'Sky lantern', price: 260, comfort: 6, glow: '#ffb35c' },
  // rocks
  { id: 'shellLamp', slot: 'rockL', icon: '🐚', name: 'Shell lamp', price: 90, comfort: 3, glow: '#ffd9a0' },
  { id: 'lighthouse', slot: 'rockL', icon: '🗼', name: 'Tiny lighthouse', price: 420, comfort: 8, glow: '#fff1b0' },
  { id: 'crab', slot: 'rockL', icon: '🦀', name: 'Crab friend', price: 0, comfort: 4, find: { game: 'catch', text: 'Play Crab Catch' } },
  { id: 'flag', slot: 'rockR', icon: '🚩', name: 'Little flag', price: 50, comfort: 1 },
  { id: 'telescope', slot: 'rockR', icon: '🔭', name: 'Telescope', price: 300, comfort: 6 },
  { id: 'gem', slot: 'rockR', icon: '💎', name: 'Miner\'s gem', price: 0, comfort: 5, find: { game: 'miner', text: 'Play Deep Miner' } },
  { id: 'cube', slot: 'rockR', icon: '🧊', name: 'Puzzle cube', price: 0, comfort: 4, find: { game: 'cube', text: 'Play Cube Twist' } },
  // plants
  { id: 'palm', slot: 'plantL', icon: '🌴', name: 'Palm', price: 80, comfort: 3 },
  { id: 'cactus', slot: 'plantL', icon: '🌵', name: 'Cactus', price: 50, comfort: 2 },
  { id: 'sunflower', slot: 'plantL', icon: '🌻', name: 'Sunflower', price: 150, comfort: 4 },
  { id: 'coral', slot: 'plantR', icon: '🪸', name: 'Coral', price: 120, comfort: 4 },
  { id: 'tulip', slot: 'plantR', icon: '🌷', name: 'Tulip', price: 60, comfort: 2 },
  { id: 'blossom', slot: 'plantR', icon: '🌸', name: 'Blossom', price: 220, comfort: 5 },
  // pool
  { id: 'duck', slot: 'pool', icon: '🦆', name: 'Rubber duck', price: 70, comfort: 3 },
  { id: 'fish', slot: 'pool', icon: '🐠', name: 'Tropical fish', price: 140, comfort: 4 },
  { id: 'boat', slot: 'pool', icon: '⛵', name: 'Toy boat', price: 200, comfort: 5 },
  { id: 'puffer', slot: 'pool', icon: '🐡', name: 'Puffer pal', price: 0, comfort: 5, find: { game: 'puffer', text: 'Play Puffer Dash' } },
  // Pip's bed
  { id: 'basket', slot: 'bed', icon: '🧺', name: 'Basket bed', price: 100, comfort: 4 },
  { id: 'cushion', slot: 'bed', icon: '🛏️', name: 'Comfy bed', price: 350, comfort: 8 },
  { id: 'shellBed', slot: 'bed', icon: '🦪', name: 'Shell bed', price: 0, comfort: 6, find: { games: 5, text: 'Play 5 different games' } },
  // light
  { id: 'candle', slot: 'light', icon: '🕯️', name: 'Candle', price: 60, comfort: 3, glow: '#ffc370' },
  { id: 'lantern', slot: 'light', icon: '🏮', name: 'Paper lantern', price: 180, comfort: 5, glow: '#ff9d4d' },
  { id: 'campfire', slot: 'light', icon: '🔥', name: 'Campfire', price: 400, comfort: 9, glow: '#ff8a3d', flicker: true },
  // seat
  { id: 'chair', slot: 'seat', icon: '🪑', name: 'Chair', price: 90, comfort: 3 },
  { id: 'umbrella', slot: 'seat', icon: '⛱️', name: 'Beach umbrella', price: 160, comfort: 5 },
  { id: 'chess', slot: 'seat', icon: '♟️', name: 'Chess set', price: 0, comfort: 5, find: { game: 'chess', text: 'Play Chess' } },
  { id: 'dice', slot: 'seat', icon: '🎲', name: 'Lucky dice', price: 0, comfort: 4, find: { game: 'ludo', text: 'Play Ludo' } },
  // rug
  { id: 'towel', slot: 'rug', icon: '🏖️', name: 'Beach towel', price: 40, comfort: 2, rug: ['#4fc3f7', '#ffffff'] },
  { id: 'rugRed', slot: 'rug', icon: '🧶', name: 'Woven rug', price: 120, comfort: 4, rug: ['#c0504d', '#f2c14e'] },
  { id: 'rugNight', slot: 'rug', icon: '🌙', name: 'Starry rug', price: 260, comfort: 6, rug: ['#2b3a78', '#ffd45e'] },
];
// Seasonal decor: sold only during its season (you keep it forever) – ~3,800 🐚 a season.
ITEMS.push(
  { id: 'lifering', slot: 'pool', icon: '🛟', name: 'Life ring', price: 800, comfort: 6, season: 's0' },
  { id: 'whaleKite', slot: 'sky', icon: '🐋', name: 'Whale kite', price: 900, comfort: 7, season: 's0' },
  { id: 'mermaid', slot: 'rockR', icon: '🧜', name: 'Mermaid statue', price: 1200, comfort: 8, season: 's0' },
  { id: 'bubbleLamp', slot: 'light', icon: '🫧', name: 'Bubble lamp', price: 900, comfort: 7, glow: '#bfe9ff', season: 's0' },
  { id: 'garland', slot: 'sky', icon: '❄️', name: 'Snowflake garland', price: 800, comfort: 7, season: 's1' },
  { id: 'tree', slot: 'plantL', icon: '🎄', name: 'Little tree', price: 1000, comfort: 8, glow: '#ffd45e', season: 's1' },
  { id: 'snowpal', slot: 'rockL', icon: '⛄', name: 'Snow pal', price: 900, comfort: 7, season: 's1' },
  { id: 'diya', slot: 'light', icon: '🪔', name: 'Oil lamp', price: 1100, comfort: 9, glow: '#ffb35c', flicker: true, season: 's1' },
  { id: 'squid', slot: 'pool', icon: '🦑', name: 'Squid buddy', price: 900, comfort: 7, season: 's2' },
  { id: 'deepRug', slot: 'rug', icon: '🌌', name: 'Deep-sea rug', price: 900, comfort: 7, rug: ['#1a1446', '#7e57c2'], season: 's2' },
  { id: 'orb', slot: 'light', icon: '🔮', name: 'Glow orb', price: 1100, comfort: 9, glow: '#b388ff', season: 's2' },
  { id: 'anchor', slot: 'rockR', icon: '⚓', name: 'Old anchor', price: 900, comfort: 7, season: 's2' },
  { id: 'hibiscus', slot: 'plantR', icon: '🌺', name: 'Hibiscus', price: 900, comfort: 7, season: 's3' },
  { id: 'flamingo', slot: 'seat', icon: '🦩', name: 'Flamingo float', price: 1000, comfort: 8, season: 's3' },
  { id: 'rainbow', slot: 'sky', icon: '🌈', name: 'Rainbow', price: 1000, comfort: 8, season: 's3' },
  { id: 'lotus', slot: 'pool', icon: '🪷', name: 'Lotus', price: 900, comfort: 7, season: 's3' },
);
export const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/** Polishing an owned item adds comfort: level 2 and 3 cost shells (a sink that keeps going). */
export const POLISH = [0, 0, 600, 1500];
export const MAX_STARS = 8;
export const itemComfort = (pool, id) => (ITEM[id]?.comfort || 0) + ((pool?.lvl?.[id] || 1) - 1) * 3;

/** Comfort points from what's placed, and the matching level (0–8). */
const LEVELS = [0, 6, 16, 28, 42, 56, 68, 80, 92]; // stars 6–8 need polished pieces
export function comfortOf(pool) {
  const pts = Object.values(pool?.placed || {}).reduce((n, id) => n + itemComfort(pool, id), 0);
  let level = 0;
  for (let i = 0; i < LEVELS.length; i++) if (pts >= LEVELS[i]) level = i;
  return { pts, level, next: LEVELS[level + 1] ?? null };
}
/** Extra shells on the daily treasure for a cozy cove. */
export const comfortBonus = (pool) => comfortOf(pool).level * 5;

/** Has the player met an item's "find it by playing" condition? */
export function found(item, save) {
  const f = item.find;
  if (!f) return true;
  const arcade = save.arcade || {};
  if (f.game) return (arcade[f.game]?.games || 0) > 0;
  if (f.games) {
    const played = Object.values(arcade).filter((g) => (g.games || 0) > 0).length + ((save.stats?.levelsWon || 0) > 0 ? 1 : 0) + ((save.blocks?.games || 0) > 0 ? 1 : 0);
    return played >= f.games;
  }
  return false;
}

/** Items the player could pick up for free right now (found but not owned). */
export function newlyFound(save) {
  const owned = save.pool?.owned || {};
  return ITEMS.filter((i) => i.find && !owned[i.id] && found(i, save));
}

// ---------------------------------------------------------------- scene
const skyFor = (h, cozy) => {
  if (cozy || h >= 21 || h < 5) return ['#0b1433', '#1b2a55', '#2a3f73'];
  if (h < 8) return ['#f7b3a1', '#fbd3a6', '#c9e4f2'];
  if (h < 17) return ['#6cc6f2', '#a9defa', '#e3f5ff'];
  return ['#f08a5d', '#f6b26b', '#8c7cc4'];
};

/**
 * Draw the cove. opts: { night, raining, fire, highlight: slotId, now, pipAsleep }
 * Returns the hit boxes of each slot (for taps).
 */
export function drawPool(ctx, W, H, pool, opts = {}) {
  const now = opts.now || performance.now();
  const hour = new Date().getHours();
  const night = opts.night || hour >= 21 || hour < 5;
  const [s0, s1, s2] = skyFor(hour, opts.night);
  ctx.clearRect(0, 0, W, H);
  // sky + sea
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, s0); sky.addColorStop(0.6, s1); sky.addColorStop(1, s2);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.5);
  if (night) {
    ctx.fillStyle = '#fff7d6';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97.13) % W, y = (i * 53.7) % (H * 0.36);
      const tw = 0.4 + 0.4 * Math.sin(now / 900 + i);
      ctx.globalAlpha = opts.raining ? tw * 0.3 : tw;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    // moon
    ctx.fillStyle = '#fff3c4';
    ctx.shadowColor = 'rgba(255,240,190,.8)'; ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(W * 0.8, H * 0.12, W * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = hour < 8 || hour >= 17 ? '#ffd27a' : '#fff6c9';
    ctx.shadowColor = 'rgba(255,220,120,.9)'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(W * 0.8, H * (hour >= 17 ? 0.33 : 0.12), W * 0.055, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  const sea = ctx.createLinearGradient(0, H * 0.36, 0, H * 0.5);
  sea.addColorStop(0, night ? '#1d3766' : '#2f8fd0'); sea.addColorStop(1, night ? '#142850' : '#1f6fb0');
  ctx.fillStyle = sea;
  ctx.fillRect(0, H * 0.36, W, H * 0.16);
  // gentle wave lines
  ctx.strokeStyle = night ? 'rgba(170,200,255,.25)' : 'rgba(255,255,255,.45)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * (0.39 + k * 0.04) + Math.sin(x / 26 + now / 900 + k) * 2);
    ctx.stroke();
  }
  // sand
  const sand = ctx.createLinearGradient(0, H * 0.48, 0, H);
  sand.addColorStop(0, night ? '#5a4a3a' : '#f2d8a7'); sand.addColorStop(1, night ? '#3d3127' : '#e2bd80');
  ctx.fillStyle = sand;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.52);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, H * 0.5 + Math.sin(x / 40) * 4);
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  // rocks framing the cove
  const rock = (cx, cy, rx, ry) => {
    const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, 2, cx, cy, rx);
    g.addColorStop(0, night ? '#5d6475' : '#9aa3b5'); g.addColorStop(1, night ? '#2b3040' : '#5b6274');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  };
  rock(W * 0.13, H * 0.5, W * 0.17, H * 0.12);
  rock(W * 0.87, H * 0.5, W * 0.17, H * 0.12);
  // the tide pool
  const px = W * 0.53, py = H * 0.66, prx = W * 0.25, pry = H * 0.09;
  ctx.fillStyle = night ? '#2c3a52' : '#c9a873';
  ctx.beginPath(); ctx.ellipse(px, py + 3, prx + 6, pry + 5, 0, 0, Math.PI * 2); ctx.fill();
  const water = ctx.createRadialGradient(px - prx * 0.3, py - pry * 0.4, 4, px, py, prx);
  water.addColorStop(0, night ? '#3b6aa8' : '#7fe0ef'); water.addColorStop(1, night ? '#1a3563' : '#2a9dc4');
  ctx.fillStyle = water;
  ctx.beginPath(); ctx.ellipse(px, py, prx, pry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = night ? 'rgba(200,220,255,.25)' : 'rgba(255,255,255,.5)';
  for (let k = 0; k < 2; k++) {
    const r = ((now / 3000 + k * 0.5) % 1);
    ctx.globalAlpha = 1 - r;
    ctx.beginPath(); ctx.ellipse(px + prx * 0.2, py, prx * 0.15 + r * prx * 0.4, pry * 0.15 + r * pry * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // placed items (glow first, then the items)
  const hits = [];
  const fire = Object.values(pool?.placed || {}).some((id) => ITEM[id]?.flicker);
  for (const s of SLOTS) {
    const it = ITEM[pool?.placed?.[s.id]];
    if (it?.glow && (night || opts.night)) {
      const f = it.flicker ? 0.85 + 0.15 * Math.sin(now / 120) * Math.sin(now / 77) : 1;
      const r = Math.min(W, H) * (it.flicker ? 0.34 : 0.22) * f;
      const g = ctx.createRadialGradient(s.x * W, s.y * H, 2, s.x * W, s.y * H, r);
      g.addColorStop(0, hexA(it.glow, 0.55)); g.addColorStop(1, hexA(it.glow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(s.x * W - r, s.y * H - r, r * 2, r * 2);
    }
  }
  for (const s of [...SLOTS].sort((a, b) => (a.id === 'rug' ? -1 : b.id === 'rug' ? 1 : 0))) {
    const it = ITEM[pool?.placed?.[s.id]];
    const size = Math.min(W, H) * s.size * 1.35;
    const x = s.x * W, y = s.y * H;
    hits.push({ id: s.id, x: x - size * 0.7, y: y - size * 0.75, w: size * 1.4, h: size * 1.4 });
    if (opts.highlight === s.id || (!it && opts.showEmpty)) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = opts.highlight === s.id ? '#ffd45e' : 'rgba(255,255,255,.45)';
      ctx.lineWidth = opts.highlight === s.id ? 3 : 1.5;
      ctx.beginPath(); ctx.ellipse(x, y, size * 0.55, size * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      if (!it) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `800 ${size * 0.35}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', x, y); }
      ctx.restore();
    }
    if (!it) continue;
    if (it.rug) {
      // a woven rug lying on the sand
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, size * 1.3, size * 0.32, 0, 0, Math.PI * 2); ctx.clip();
      for (let k = -6; k <= 6; k++) { ctx.fillStyle = it.rug[k & 1]; ctx.fillRect(x + k * size * 0.22 - size * 0.11, y - size * 0.4, size * 0.22, size * 0.8); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y, size * 1.3, size * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    let dy = 0;
    if (s.id === 'pool') dy = Math.sin(now / 700) * size * 0.06; // bobbing
    if (s.id === 'sky') dy = Math.sin(now / 1300) * size * 0.1;
    // little shadow on the sand
    if (!['sky', 'pool', 'rockL', 'rockR'].includes(s.id)) {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(x, y + size * 0.42, size * 0.42, size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000'; // colour emoji take the fill's transparency – keep it opaque
    ctx.fillText(it.icon, x, y + dy);
  }
  // Pip, napping in his bed (or on the sand)
  const bed = SLOTS.find((s) => s.id === 'bed');
  const hasBed = !!pool?.placed?.bed;
  const psz = Math.min(W, H) * 0.12;
  // in his bed, or curled up on the sand beside the empty spot
  const bx = bed.x * W + (hasBed ? 0 : psz * 0.95), by = bed.y * H - (hasBed ? psz * 0.35 : -psz * 0.1);
  const breathe = 1 + Math.sin(now / 700) * 0.03;
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(breathe, 1 / breathe);
  ctx.font = `${psz}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText('🦦', 0, 0);
  ctx.restore();
  if (opts.pipAsleep ?? night) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = `900 ${psz * 0.3}px system-ui`;
    const t = (now / 2500) % 1;
    ctx.globalAlpha = 1 - t;
    ctx.fillText('z', bx + psz * 0.5 + t * 10, by - psz * 0.5 - t * 18);
    ctx.globalAlpha = 1;
  }
  hits.push({ id: 'pip', x: bx - psz * 0.6, y: by - psz * 0.6, w: psz * 1.2, h: psz * 1.2 });
  // rain over the cove in cozy rain
  if (opts.raining) {
    ctx.strokeStyle = 'rgba(200,220,255,.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      const x = ((i * 53.3 + now * 0.35 * (1 + (i % 3) * 0.2)) % (W + 40)) - 20;
      const y = ((i * 91.7 + now * 0.9 * (1 + (i % 4) * 0.15)) % (H + 30)) - 15;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y - 10); ctx.stroke();
    }
  }
  // the vibe outside the cove
  if (opts.vibe === 'snow') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 70; i++) {
      const z = (i % 5) / 4;
      const x = ((i * 61.7 + Math.sin(now / 1500 + i) * 20 + now * 0.01) % (W + 20)) - 10;
      const y = ((i * 37.3 + now * (0.02 + z * 0.04)) % (H + 10)) - 5;
      ctx.beginPath(); ctx.arc(x, y, 0.8 + z * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,245,255,0.75)'; // snow settling on the rocks
    ctx.beginPath(); ctx.ellipse(W * 0.13, H * 0.42, W * 0.13, H * 0.03, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(W * 0.87, H * 0.42, W * 0.13, H * 0.03, 0, 0, Math.PI * 2); ctx.fill();
  } else if (opts.vibe === 'forest') {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const b = Math.max(0, Math.sin(now / 900 + i * 2.3)) ** 3;
      if (b < 0.05) continue;
      const x = W * ((i * 0.137 + 0.05) % 1) + Math.sin(now / 2000 + i) * 12, y = H * (0.45 + ((i * 0.29) % 0.5)) + Math.cos(now / 1700 + i) * 8;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
      g.addColorStop(0, `rgba(230,255,150,${b})`); g.addColorStop(1, 'rgba(205,255,110,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 10, y - 10, 20, 20);
    }
    ctx.globalCompositeOperation = 'source-over';
  } else if (opts.vibe === 'fire' || opts.vibe === 'rainfire') {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const life = ((now / 1000) * (0.35 + (i % 4) * 0.1) + i * 0.17) % 1;
      const x = W * (0.5 + Math.sin(i * 12.9) * 0.3) + Math.sin(now / 400 + i) * 8, y = H * (1 - life * 0.9);
      ctx.fillStyle = `rgba(255,${200 - life * 120},${90 - life * 70},${(1 - life) * 0.9})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  } else if (opts.vibe === 'ocean') {
    ctx.fillStyle = 'rgba(240,240,220,0.35)'; // moonlight on the sea
    for (let k = 0; k < 6; k++) { const w = (14 + k * 6) * (0.6 + 0.4 * Math.sin(now / 600 + k)); ctx.fillRect(W * 0.8 - w / 2, H * (0.38 + k * 0.022), w, 1.5); }
  }
  if (fire && night) {
    // warm wash over the whole scene from the campfire
    ctx.fillStyle = `rgba(255,140,60,${0.05 + 0.03 * Math.sin(now / 150)})`;
    ctx.fillRect(0, 0, W, H);
  }
  return hits;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

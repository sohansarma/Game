// Live-ops: rotating daily missions + a weekly tier, the free Tide Pass
// (seasonal XP track with cosmetic rewards, no paid track), the sticker
// album and Pip's wardrobe (a shell sink that never runs dry).
// Pure functions over the save object – the UI lives in main.js.

import { hashString, Rng } from './rng.js';

// ---------------------------------------------------------------- missions
// Each template reads the day's counters in d.missions:
// { day, best, hot, games, ids: [], tide, versus, levels, cove, claimed }
export const MISSION_POOL = [
  { id: 'dailies', easy: true, text: () => 'Play 3 daily challenges', goal: 3, cur: (m, ctx) => ctx.dailies },
  { id: 'games5', easy: true, text: () => 'Finish 5 games', goal: 5, cur: (m) => m.games || 0 },
  { id: 'games3', easy: true, text: () => 'Finish 3 games', goal: 3, cur: (m) => m.games || 0 },
  { id: 'best', text: () => 'Beat one of your personal bests', goal: 1, cur: (m) => m.best || 0 },
  { id: 'hot', text: (ctx) => `Play today's hot game: ${ctx.hot.icon} ${ctx.hot.title}`, goal: 1, cur: (m) => m.hot || 0 },
  { id: 'variety', text: () => 'Play 3 different games', goal: 3, cur: (m) => (m.ids || []).length },
  { id: 'tide', text: () => 'Solve Tide of the Day', goal: 1, cur: (m) => m.tide || 0 },
  { id: 'friends', text: () => 'Play a game of Chess or Ludo', goal: 1, cur: (m) => m.versus || 0 },
  { id: 'swap', text: () => 'Play 2 Shell Swap levels', goal: 2, cur: (m) => m.levels || 0 },
  { id: 'blocks', text: () => 'Play a round of Reef Blocks', goal: 1, cur: (m) => ((m.ids || []).includes('reef') ? 1 : 0) },
  { id: 'cove', text: () => 'Visit your Cozy Cove', goal: 1, cur: (m) => m.cove || 0 },
  { id: 'arcade', text: () => 'Play 2 different arcade games', goal: 2, cur: (m) => (m.ids || []).filter((i) => !['tidepop', 'reef', 'chess', 'ludo', 'tide', 'community'].includes(i)).length },
];

/** The 3 missions for a day: one easy, two rotating (same for everyone). */
export function pickMissions(day) {
  const rng = new Rng(hashString('missions:' + day));
  const easy = MISSION_POOL.filter((m) => m.easy);
  const rest = MISSION_POOL.filter((m) => !m.easy);
  const a = easy[rng.int(easy.length)];
  const pool = rng.shuffle(rest.slice());
  return [a, pool[0], pool[1]];
}

/** Counters for a finished game. kind: 'versus' | 'level' | 'tide' | undefined */
export function noteMissionGame(d, day, id, { best = false, hot = false, kind } = {}) {
  if (d.missions?.day !== day) d.missions = { day, best: 0, hot: 0, claimed: false };
  const m = d.missions;
  m.games = (m.games || 0) + 1;
  if (best) m.best = (m.best || 0) + 1;
  if (hot) m.hot = (m.hot || 0) + 1;
  if (kind === 'versus' || id === 'chess' || id === 'ludo') m.versus = (m.versus || 0) + 1;
  if (kind === 'level') m.levels = (m.levels || 0) + 1;
  if (id === 'tide' && kind === 'tide') m.tide = 1;
  m.ids = [...new Set([...(m.ids || []), id])];
}

// ---------------------------------------------------------------- weekly
// d.week = { week, chests, ids: [], tideDays, games, claimed }
export const WEEKLY = [
  { id: 'chests', text: 'Open the daily mission chest on 4 days', goal: 4, cur: (w) => w.chests || 0 },
  { id: 'variety', text: 'Play 6 different games', goal: 6, cur: (w) => (w.ids || []).length },
  { id: 'games', text: 'Finish 25 games', goal: 25, cur: (w) => w.games || 0 },
];
export const WEEKLY_REWARD = { shells: 500, packs: 2, xp: 250 };

export function weekState(d, week) {
  return d.week?.week === week ? d.week : { week, chests: 0, ids: [], games: 0, claimed: false };
}
export function noteWeekGame(d, week, id) {
  const w = (d.week = weekState(d, week));
  w.games = (w.games || 0) + 1;
  w.ids = [...new Set([...(w.ids || []), id])];
}

// ---------------------------------------------------------------- Tide Pass
// Free seasons. XP from finishing any game, chests and Tide of the Day.
export const SEASONS = [
  { id: 's0', name: 'First Tide', icon: '🌊', from: '2026-10-01', to: '2026-11-30', outfit: 'snorkel' },
  { id: 's1', name: 'Winter Lights', icon: '🏮', from: '2026-12-01', to: '2027-02-28', outfit: 'scarf' },
  { id: 's2', name: 'Abyss', icon: '🐙', from: '2027-03-01', to: '2027-05-31', outfit: 'lantern' },
  { id: 's3', name: 'Coral Bloom', icon: '🪸', from: '2027-06-01', to: '2027-08-31', outfit: 'flower' },
];
export const TIERS = 30;
export const XP_PER_TIER = 120;
export const XP = { game: 10, gameCapPerDay: 30, chest: 60, tide: 30, weekly: 250 };

export function seasonAt(day) {
  const s = SEASONS.find((x) => day >= x.from && day <= x.to);
  if (s) return s;
  // after the scripted seasons: a quarterly "Open Sea" season keeps running
  const [y, mo] = day.split('-').map(Number);
  const q = Math.floor((mo - 1) / 3);
  const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  const endMonth = q * 3 + 3;
  const to = `${y}-${String(endMonth).padStart(2, '0')}-${[31, 30, 30, 31][q]}`;
  return { id: `q${y}${q}`, name: 'Open Sea', icon: '⛵', from, to, outfit: 'captain' };
}

/** Days left in the season (inclusive of today). */
export function seasonDaysLeft(season, day) {
  return Math.max(0, Math.round((Date.parse(season.to + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000) + 1);
}

/** Reward for reaching a tier (1-based). Cosmetics on milestones, shells & packs between. */
export function tierReward(season, tier) {
  if (tier === TIERS) return { outfit: season.outfit, shells: 300, label: `${OUTFIT[season.outfit]?.icon || '🎁'} ${OUTFIT[season.outfit]?.name || 'Season outfit'} for Pip + 300 🐚` };
  if (tier % 10 === 0) return { packs: 3, shells: 150, label: '3 sticker packs + 150 🐚' };
  if (tier % 5 === 0) return { packs: 2, label: '2 sticker packs' };
  if (tier % 2 === 0) return { packs: 1, label: '1 sticker pack' };
  return { shells: 40 + tier * 3, label: `${40 + tier * 3} 🐚` };
}

export function passState(d, season) {
  return d.pass?.season === season.id ? d.pass : { season: season.id, xp: 0, claimed: 0, day: '', dayGames: 0 };
}
export const tierOfXp = (xp) => Math.min(TIERS, Math.floor(xp / XP_PER_TIER));

/** Adds XP (game XP is capped per day). Returns the XP actually added. */
export function addXp(d, season, day, amount, { game = false } = {}) {
  const p = (d.pass = passState(d, season));
  if (p.day !== day) { p.day = day; p.dayGames = 0; }
  if (game) {
    if (p.dayGames >= XP.gameCapPerDay) return 0;
    p.dayGames++;
  }
  p.xp += amount;
  return amount;
}

/** Claims every reached tier; returns the list of rewards granted. */
export function claimTiers(d, season, rollPack) {
  const p = (d.pass = passState(d, season));
  const reached = tierOfXp(p.xp);
  const got = [];
  while (p.claimed < reached) {
    p.claimed++;
    const r = tierReward(season, p.claimed);
    got.push({ tier: p.claimed, label: r.label });
    if (r.shells) d.shells += r.shells;
    if (r.outfit) { d.outfits = { ...(d.outfits || {}), [r.outfit]: 1 }; }
    if (r.packs) for (let i = 0; i < r.packs; i++) got.push(...openPack(d, rollPack));
  }
  return got;
}

// ---------------------------------------------------------------- stickers
// Game stickers come from playing that game; sea-life stickers from packs.
export const STICKERS = [
  // page 1 – the games (earned by playing)
  { id: 'g-tidepop', icon: '🐚', name: 'Shell Swap', page: 0, game: 'tidepop' },
  { id: 'g-reef', icon: '🧱', name: 'Reef Blocks', page: 0, game: 'reef' },
  { id: 'g-chess', icon: '♟️', name: 'Chess', page: 0, game: 'chess' },
  { id: 'g-ludo', icon: '🎲', name: 'Ludo', page: 0, game: 'ludo' },
  { id: 'g-cube', icon: '🧊', name: 'Cube Twist', page: 0, game: 'cube' },
  { id: 'g-miner', icon: '⛏️', name: 'Deep Miner', page: 0, game: 'miner' },
  { id: 'g-puffer', icon: '🐡', name: 'Puffer Dash', page: 0, game: 'puffer' },
  { id: 'g-serpent', icon: '🐍', name: 'Sea Serpent', page: 0, game: 'serpent' },
  { id: 'g-merge', icon: '🐳', name: 'Shell Merge', page: 0, game: 'merge' },
  { id: 'g-stack', icon: '🗼', name: 'Reef Tower', page: 0, game: 'stack' },
  { id: 'g-sort', icon: '🧪', name: 'Sort Splash', page: 0, game: 'sort' },
  { id: 'g-breaker', icon: '💥', name: 'Coral Breaker', page: 0, game: 'breaker' },
  { id: 'g-catch', icon: '🦀', name: 'Crab Catch', page: 0, game: 'catch' },
  { id: 'g-tide', icon: '🌊', name: 'Tide of the Day', page: 0, game: 'tide' },
  { id: 'g-community', icon: '🌟', name: 'Community game', page: 0, game: 'community' },
  // page 2 – shallows (common)
  ...[['🐟', 'Minnow'], ['🐠', 'Clownfish'], ['🦐', 'Shrimp'], ['🐌', 'Sea snail'], ['🦀', 'Hermit crab'], ['⭐', 'Starfish'], ['🪼', 'Moon jelly'], ['🐚', 'Conch'], ['🪸', 'Brain coral'], ['🦆', 'Sea duck'], ['🐸', 'Tide-pool frog'], ['🦞', 'Lobster']]
    .map(([icon, name], i) => ({ id: `s${i}`, icon, name, page: 1, rarity: 'common' })),
  // page 3 – open sea (rare)
  ...[['🐢', 'Sea turtle'], ['🐬', 'Dolphin'], ['🦭', 'Seal'], ['🦦', 'Otter (Pip!)'], ['🐙', 'Octopus'], ['🦑', 'Squid'], ['🐡', 'Pufferfish'], ['🦩', 'Flamingo'], ['🐧', 'Penguin']]
    .map(([icon, name], i) => ({ id: `o${i}`, icon, name, page: 2, rarity: 'rare' })),
  // page 4 – the deep (epic)
  ...[['🦈', 'Shark'], ['🐋', 'Blue whale'], ['🐳', 'Humpback'], ['🧜', 'Merfolk'], ['🔱', 'Trident'], ['💎', 'Deep gem']]
    .map(([icon, name], i) => ({ id: `d${i}`, icon, name, page: 3, rarity: 'epic' })),
];
export const STICKER = Object.fromEntries(STICKERS.map((s) => [s.id, s]));
export const PAGES = ['The games', 'Shallows', 'Open sea', 'The deep'];
export const PAGE_REWARD = [200, 300, 500, 1000];
export const DUPE_SHELLS = { common: 5, rare: 15, epic: 40 };

/** Opens one pack of 3 stickers (common 75% / rare 20% / epic 5%). */
export function openPack(d, roll = Math.random) {
  const got = [];
  d.stickers ||= {};
  for (let i = 0; i < 3; i++) {
    const r = roll();
    const rarity = r < 0.05 ? 'epic' : r < 0.25 ? 'rare' : 'common';
    const pool = STICKERS.filter((s) => s.rarity === rarity);
    const s = pool[Math.floor(roll() * pool.length) % pool.length];
    const dupe = !!d.stickers[s.id];
    d.stickers[s.id] = (d.stickers[s.id] || 0) + 1;
    if (dupe) d.shells += DUPE_SHELLS[rarity];
    got.push({ sticker: s.id, dupe, label: `${s.icon} ${s.name}${dupe ? ` (spare: +${DUPE_SHELLS[rarity]} 🐚)` : ' – new!'}` });
  }
  return got;
}

/** Game stickers are given for playing; returns ids that are new. */
export function grantGameSticker(d, gameId) {
  const s = STICKERS.find((x) => x.game === gameId);
  if (!s) return null;
  d.stickers ||= {};
  if (d.stickers[s.id]) return null;
  d.stickers[s.id] = 1;
  return s;
}

/** Pages just completed (reward not yet paid). */
export function claimPages(d) {
  d.albumPaid ||= {};
  const done = [];
  PAGES.forEach((name, p) => {
    if (d.albumPaid[p]) return;
    if (STICKERS.filter((s) => s.page === p).every((s) => d.stickers?.[s.id])) {
      d.albumPaid[p] = 1;
      d.shells += PAGE_REWARD[p];
      done.push({ page: p, name, shells: PAGE_REWARD[p] });
    }
  });
  return done;
}

// ---------------------------------------------------------------- wardrobe
// Pip's outfits: bought with shells (a sink that scales), or won in seasons.
export const OUTFITS = [
  { id: 'bow', icon: '🎀', name: 'Bow', price: 250 },
  { id: 'cap', icon: '🧢', name: 'Cap', price: 400 },
  { id: 'sunhat', icon: '👒', name: 'Sun hat', price: 600 },
  { id: 'shades', icon: '🕶️', name: 'Sunglasses', price: 800 },
  { id: 'tophat', icon: '🎩', name: 'Top hat', price: 1200 },
  { id: 'grad', icon: '🎓', name: 'Scholar cap', price: 1800 },
  { id: 'crown', icon: '👑', name: 'Crown', price: 4000 },
  // season rewards (not for sale)
  { id: 'snorkel', icon: '🤿', name: 'Snorkel', season: 'First Tide' },
  { id: 'scarf', icon: '🧣', name: 'Winter scarf', season: 'Winter Lights' },
  { id: 'lantern', icon: '🏮', name: 'Deep-sea lantern', season: 'Abyss' },
  { id: 'flower', icon: '🌺', name: 'Coral flower', season: 'Coral Bloom' },
  { id: 'captain', icon: '⚓', name: 'Captain\'s anchor', season: 'Open Sea' },
];
export const OUTFIT = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));

export function buyOutfit(d, id) {
  const o = OUTFIT[id];
  if (!o || !o.price || d.outfits?.[id] || d.shells < o.price) return false;
  d.shells -= o.price;
  d.outfits = { ...(d.outfits || {}), [id]: 1 };
  d.pipOutfit = id;
  return true;
}

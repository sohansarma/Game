// Local persistence. Everything lives on the device – no account needed.

const KEY = 'tidepop.save.v1';

export const ADJECTIVES = ['Bubbly', 'Sunny', 'Brave', 'Happy', 'Swift', 'Clever', 'Jolly', 'Mighty', 'Shiny', 'Cosy',
  'Lucky', 'Breezy', 'Zippy', 'Gentle', 'Sparkly', 'Bouncy', 'Witty', 'Calm', 'Cheery', 'Golden'];
export const ANIMALS = ['Otter', 'Dolphin', 'Seal', 'Puffin', 'Turtle', 'Octopus', 'Crab', 'Starfish', 'Seahorse', 'Orca',
  'Narwhal', 'Pelican', 'Manatee', 'Clownfish', 'Walrus', 'Penguin', 'Squid', 'Shrimp', 'Lobster', 'Whale'];

export function randomNickname() {
  const r = (n) => Math.floor(Math.random() * n);
  return `${ADJECTIVES[r(ADJECTIVES.length)]} ${ANIMALS[r(ANIMALS.length)]} ${10 + r(90)}`;
}

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function defaultSave() {
  return {
    v: 1,
    createdAt: Date.now(),
    playerId: uuid(),
    name: randomNickname(),
    token: null, // issued by leaderboard server
    onboarded: false,
    levels: {}, // n -> { stars, best }
    shells: 50,
    boosters: { hammer: 2, shuffle: 2, moves: 1 },
    daily: { lastClaim: null, streak: 0 },
    dailyDive: {}, // dayKey -> { best, ranked: bool }
    deep: {}, // weekKey -> best
    blocks: { best: 0, games: 0 },
    blocksDaily: {}, // dayKey -> best
    blocksRun: null, // in-progress endless run { seed, log }
    achievements: {},
    stats: { matches: 0, specials: 0, rainbows: 0, bestCascade: 0, levelsWon: 0, gamesPlayed: 0, lines: 0, perfectClears: 0, bestCombo: 0 },
    settings: { sfx: true, music: true, haptics: true, reducedMotion: false, leaderboard: true },
    pending: [], // unsent leaderboard submissions
  };
}

let cache = null;

export function load() {
  if (cache) return cache;
  let data = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = JSON.parse(raw);
  } catch {
    data = null; // corrupted or storage blocked
  }
  cache = migrate(data);
  return cache;
}

function migrate(data) {
  const base = defaultSave();
  if (!data || typeof data !== 'object' || data.v !== 1) return base;
  // deep-merge defaults so new fields appear after updates
  const out = { ...base, ...data };
  for (const k of ['boosters', 'daily', 'blocks', 'stats', 'settings']) out[k] = { ...base[k], ...(data[k] || {}) };
  if (!Array.isArray(out.pending)) out.pending = [];
  return out;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full / private mode – game still works for this session */
  }
}

export function update(fn) {
  fn(load());
  save();
}

export function exportSave() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(load()))));
}

export function importSave(code) {
  const data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (!data || data.v !== 1 || typeof data.levels !== 'object') throw new Error('Not a Tidepop save code');
  cache = migrate(data);
  save();
}

export function resetSave() {
  const keepId = load().playerId;
  cache = defaultSave();
  cache.playerId = keepId;
  save();
}

// Keep tabs in sync: if another tab saves, drop our cache.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) cache = null;
  });
}

export function totalStars(s = load()) {
  return Object.values(s.levels).reduce((a, l) => a + (l.stars || 0), 0);
}

export function highestUnlocked(s = load()) {
  let n = 1;
  while (s.levels[n] && s.levels[n].stars > 0) n++;
  return n;
}

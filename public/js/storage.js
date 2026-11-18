// Local persistence. Progress lives on the device – no account needed.

const KEY = 'tidepop.save.v1';

export const ADJECTIVES = ['Bubbly', 'Sunny', 'Brave', 'Happy', 'Swift', 'Clever', 'Jolly', 'Mighty', 'Shiny', 'Cosy',
  'Lucky', 'Breezy', 'Zippy', 'Gentle', 'Sparkly', 'Bouncy', 'Witty', 'Calm', 'Cheery', 'Golden'];
export const ANIMALS = ['Otter', 'Dolphin', 'Seal', 'Puffin', 'Turtle', 'Octopus', 'Crab', 'Starfish', 'Seahorse', 'Orca',
  'Narwhal', 'Pelican', 'Manatee', 'Clownfish', 'Walrus', 'Penguin', 'Squid', 'Shrimp', 'Lobster', 'Whale'];

export function randomNickname() {
  const r = (n) => Math.floor(Math.random() * n);
  return `${ADJECTIVES[r(ADJECTIVES.length)]} ${ANIMALS[r(ANIMALS.length)]} ${10 + r(90)}`;
}

// ---------------------------------------------------------------- player names
// Players pick any name they like. The same rules run on the device and on
// the server: 3–20 characters, letters/numbers/spaces and - _ . ' only,
// no links, emails or phone numbers, no reserved or offensive words.
export const NAME_MIN = 3;
export const NAME_MAX = 20;
const RESERVED = ['admin', 'administrator', 'moderator', 'mod team', 'tidepop', 'official', 'support', 'system', 'anthropic', 'claude', 'staff', 'developer'];
// matched inside the name after removing spaces/symbols and undoing l33t-speak
// (only words that don't hide inside innocent names)
const BAD_PARTS = ['fuck', 'fuk', 'shit', 'bitch', 'nigg', 'faggot', 'whore', 'pussy', 'porn', 'penis', 'vagina', 'asshole', 'bastard', 'retard', 'wanker',
  'killyourself', 'hitler', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'bhosdi'];
// matched only as whole words (they also appear inside normal names: grape, Dickens, Scunthorpe…)
const BAD_WORDS = ['ass', 'sex', 'fag', 'kys', 'cum', 'xxx', 'mc', 'bc', 'rape', 'rapist', 'dick', 'cock', 'cunt', 'twat', 'tits', 'boob', 'boobs', 'nude', 'nudes',
  'horny', 'slut', 'nazi', 'randi', 'lund', 'gandu', 'gand', 'chod'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i' };

/** Trim and collapse spaces – the form a name is stored in. */
export function cleanName(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** null when the name is fine, otherwise a short, friendly reason. */
export function nameProblem(raw) {
  const name = cleanName(raw);
  if (name.length < NAME_MIN) return `Use at least ${NAME_MIN} characters`;
  if (name.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters`;
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} _.'-]*$/u.test(name)) return "Use letters, numbers, spaces and - _ . ' only";
  if (!/\p{L}/u.test(name)) return 'Include at least one letter';
  if (/(https?|www\.|\.(com|net|org|io|in|co|gg|me|xyz|app)\b)/i.test(name)) return 'No links, please';
  if (/\d{5,}/.test(name.replace(/[\s._-]/g, ''))) return 'No phone numbers or long numbers';
  const lower = name.toLowerCase();
  const plain = lower.replace(/[0-9@$!|]/g, (c) => LEET[c] || c);
  const squashed = plain.replace(/[^\p{L}]/gu, '');
  if (RESERVED.some((w) => squashed.includes(w.replace(/\s/g, '')))) return 'That name is reserved – try another';
  const words = plain.split(/[^\p{L}]+/u).filter(Boolean);
  const collapsed = squashed.replace(/(.)\1+/g, '$1'); // "fuuuck" -> "fuck"
  if (BAD_PARTS.some((w) => squashed.includes(w) || collapsed.includes(w)) || words.some((w) => BAD_WORDS.includes(w))) return 'Please pick a kinder name';
  return null;
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

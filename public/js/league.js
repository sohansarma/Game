// Weekly leagues: small groups (up to 30) of players in the same division.
// Points come from playing (verified runs): +10 a run (up to 30 runs a day
// count), +20 when you beat your own best on a board. At the end of the week
// the top 5 move up a division and the bottom 5 move down.
// Shared by the server (authoritative) and the claude.ai shared-db backend.

export const GROUP_SIZE = 30;
export const PROMOTE = 5;
export const DEMOTE = 5;
export const RUN_POINTS = 10;
export const BEST_POINTS = 20;
export const RUNS_PER_DAY = 30;
export const DIVISIONS = [
  { name: 'Bronze', icon: '🥉' },
  { name: 'Silver', icon: '🥈' },
  { name: 'Gold', icon: '🥇' },
  { name: 'Pearl', icon: '🦪' },
  { name: 'Diamond', icon: '💎' },
];
/** Shells for finishing 1st/2nd/3rd, a top-5 spot, or just taking part. */
export function weekReward(rank, size) {
  if (!rank) return 0;
  if (rank === 1) return 400;
  if (rank === 2) return 300;
  if (rank === 3) return 200;
  if (rank <= PROMOTE) return 120;
  return size > 1 ? 40 : 0;
}

/** Points for one verified run. state = { day, runs } per player (mutated). */
export function pointsFor(state, day, improved) {
  if (state.day !== day) { state.day = day; state.runs = 0; }
  if (state.runs >= RUNS_PER_DAY) return 0;
  state.runs++;
  return RUN_POINTS + (improved ? BEST_POINTS : 0);
}

/** Sort a group: points, then who got there first. */
export function standings(members) {
  return [...members].sort((a, b) => b.pts - a.pts || (a.at || 0) - (b.at || 0));
}

/** Division change for a final rank in a group of `size`. */
export function movement(rank, size, division) {
  if (size >= 10 && rank <= PROMOTE && division < DIVISIONS.length - 1) return 1;
  if (size >= 10 && rank > size - DEMOTE && division > 0) return -1;
  return 0;
}

/** Deterministic grouping for the shared-db backend: same division, chunks of 30 by a stable hash. */
export function groupOf(uid, list, week) {
  const h = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  const sorted = [...list].sort((a, b) => h(a.uid + week) - h(b.uid + week) || (a.uid < b.uid ? -1 : 1));
  const i = sorted.findIndex((m) => m.uid === uid);
  if (i < 0) return [];
  const g = Math.floor(i / GROUP_SIZE);
  return sorted.slice(g * GROUP_SIZE, g * GROUP_SIZE + GROUP_SIZE);
}

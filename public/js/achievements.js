// Achievements: goals that reward shells (free in-game currency).

import { load, update, totalStars } from './storage.js';
import { WORLDS } from './levels.js';
import { ARCADE } from './arcade/index.js';

const worldDone = (s, w) => {
  for (let n = w * 10 + 1; n <= w * 10 + 10; n++) if (!(s.levels[n]?.stars > 0)) return 0;
  return 1;
};

export const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🎉', name: 'First Splash', desc: 'Win your first level', goal: 1, reward: 20, get: (s) => s.stats.levelsWon },
  ...WORLDS.map((w, i) => ({ id: 'world_' + (i + 1), icon: '🗺️', name: w.name, desc: `Complete all 10 levels of ${w.name}`, goal: 1, reward: 50, get: (s) => worldDone(s, i) })),
  { id: 'stars_30', icon: '⭐', name: 'Star Collector', desc: 'Earn 30 stars', goal: 30, reward: 30, get: (s) => totalStars(s) },
  { id: 'stars_90', icon: '🌟', name: 'Star Gazer', desc: 'Earn 90 stars', goal: 90, reward: 60, get: (s) => totalStars(s) },
  { id: 'stars_180', icon: '💫', name: 'Constellation', desc: 'Earn 180 stars', goal: 180, reward: 200, get: (s) => totalStars(s) },
  { id: 'level_100', icon: '🏝️', name: 'Centurion', desc: 'Win level 100', goal: 1, reward: 150, get: (s) => (s.levels[100]?.stars ? 1 : 0) },
  { id: 'level_250', icon: '🌋', name: 'Deep Explorer', desc: 'Win level 250', goal: 1, reward: 300, get: (s) => (s.levels[250]?.stars ? 1 : 0) },
  { id: 'special_10', icon: '🌊', name: 'Wave Maker', desc: 'Create 10 special pieces', goal: 10, reward: 15, get: (s) => s.stats.specials },
  { id: 'special_200', icon: '🌀', name: 'Storm Bringer', desc: 'Create 200 special pieces', goal: 200, reward: 60, get: (s) => s.stats.specials },
  { id: 'pearl', icon: '🦪', name: 'Pearl Diver', desc: 'Create a Pearl (match 5 in a line)', goal: 1, reward: 20, get: (s) => s.stats.rainbows },
  { id: 'cascade_5', icon: '🔗', name: 'Chain Reaction', desc: 'Get a 5-step cascade', goal: 5, reward: 25, get: (s) => s.stats.bestCascade },
  { id: 'daily_1', icon: '📅', name: 'Daily Diver', desc: 'Finish a Daily Dive', goal: 1, reward: 15, get: (s) => Object.values(s.dailyDive).filter((d) => d && d.best !== undefined).length },
  { id: 'daily_7', icon: '🗓️', name: 'Regular', desc: 'Finish Daily Dives on 7 different days', goal: 7, reward: 60, get: (s) => Object.values(s.dailyDive).filter((d) => d && d.best !== undefined).length },
  { id: 'streak_7', icon: '🔥', name: 'On Fire', desc: 'Reach a 7-day login streak', goal: 7, reward: 50, get: (s) => s.daily.streak },
  { id: 'deep_50k', icon: '🐋', name: 'Deep Sea', desc: 'Score 50,000 in Deep Dive', goal: 50000, reward: 40, get: (s) => Math.max(0, ...Object.values(s.deep)) },
  { id: 'blocks_500', icon: '🧱', name: 'Reef Builder', desc: 'Score 500 in Reef Blocks', goal: 500, reward: 20, get: (s) => s.blocks.best },
  { id: 'blocks_2000', icon: '🏰', name: 'Reef Architect', desc: 'Score 2,000 in Reef Blocks', goal: 2000, reward: 60, get: (s) => s.blocks.best },
  { id: 'blocks_combo', icon: '⚡', name: 'Combo Crafter', desc: 'Reach a x5 combo in Reef Blocks', goal: 5, reward: 30, get: (s) => s.stats.bestCombo },
  { id: 'perfect', icon: '✨', name: 'Spotless', desc: 'Clear the whole Reef Blocks board', goal: 1, reward: 40, get: (s) => s.stats.perfectClears },
  { id: 'arcade_all', icon: '🕹️', name: 'Arcade Explorer', desc: `Play all ${ARCADE.length + 2} games`, goal: ARCADE.length + 2, reward: 100, get: (s) => Object.keys(s.played || {}).length },
  ...ARCADE.map((g) => ({ id: `${g.id}_pro`, icon: g.icon, name: `${g.title} Pro`, desc: `Score ${g.milestone.toLocaleString('en-US')} in ${g.title}`, goal: g.milestone, reward: 50, get: (s) => s.arcade?.[g.id]?.best || 0 })),
];

/** Check and award; returns newly unlocked achievements. */
export function checkAchievements() {
  const s = load();
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id]) continue;
    if (a.get(s) >= a.goal) unlocked.push(a);
  }
  if (unlocked.length) {
    update((d) => {
      for (const a of unlocked) {
        d.achievements[a.id] = Date.now();
        d.shells += a.reward;
      }
    });
  }
  return unlocked;
}

// Tidepop – app controller: screens, flows, progression, leaderboards.

import { Game, replay, SPECIAL } from './engine.js';
import { BlockGame, replayBlocks } from './blocks.js';
import { getLevel, LEVEL_COUNT, MAX_LEVEL, worldOf } from './levels.js';
import { dailyConfig, deepConfig, dayKey, weekKey, blocksSeed, ENGINE_VERSION, BOARDS } from './modes.js';
import { ARCADE, ARCADE_BY_ID, arcadeSeed } from './arcade/index.js';
import { hashString } from './rng.js';
import { load, update, save, totalStars, highestUnlocked, exportSave, importSave, resetSave, randomNickname, ADJECTIVES, ANIMALS } from './storage.js';
import { MatchView } from './matchview.js';
import { BlocksView } from './blocksview.js';
import { iconURL, PALETTE, clearSpriteCache } from './creatures.js';
import { sfx, unlockAudio, configureAudio, haptic } from './audio.js';
import * as api from './api.js';
import { ACHIEVEMENTS, checkAchievements } from './achievements.js';
import { $, $$, esc, fmt, showScreen, currentScreen, modal, closeModal, isModalOpen, toast, starsHtml, setBackground } from './ui.js';

let view = null; // active MatchView/BlocksView
let reloadPending = false;

const DAILY_REWARDS = [
  { shells: 20 }, { hammer: 1 }, { shells: 30 }, { shuffle: 1 }, { shells: 40 }, { moves: 1 }, { shells: 100, hammer: 1 },
];
const SHOP = [
  { id: 'hammer', icon: '🔨', name: 'Hammer', desc: 'Smash any one piece or crate. Free action.', price: 40 },
  { id: 'shuffle', icon: '🔀', name: 'Shuffle', desc: 'Mix up the whole board. Free action.', price: 30 },
  { id: 'moves', icon: '➕', name: '+5 Moves', desc: 'Five more moves when you need them.', price: 50 },
];
const BOOSTER_ICON = { hammer: '🔨', shuffle: '🔀', moves: '➕' };

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const randSeed = () => (crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32)) >>> 0;

// ------------------------------------------------------------------ boot
async function boot() {
  const s = load();
  applySettings();
  window.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      if (view) { reloadPending = true; return; }
      refreshing = true;
      location.reload();
    });
  }

  window.addEventListener('popstate', () => {
    if (view && !isModalOpen()) { history.pushState({ g: 1 }, ''); pauseMenu(); }
    else if (isModalOpen()) closeModal(null);
  });

  api.checkServer().then((ok) => { if (ok) api.flushPending().catch(() => {}); });

  showHub();
  if (!s.onboarded) await onboarding();
  else await maybeDailyReward();
}

function applySettings() {
  const s = load();
  configureAudio(s.settings);
  document.body.classList.toggle('reduced-motion', !!s.settings.reducedMotion);
}

function leaveGame() {
  if (view) { view.destroy(); view = null; }
  if (reloadPending) location.reload();
}

// ------------------------------------------------------------------ onboarding
async function onboarding() {
  let name = load().name;
  const res = await modal(`
    <div class="logo">Tide<span>pop</span></div>
    <p>Welcome to the reef! Match sea creatures, explore an endless reef of levels, take on the <b>Daily Dive</b> and build reefs in <b>Reef Blocks</b>.</p>
    <p class="small muted">Free forever · no ads · no purchases · plays offline</p>
    <div class="tip">Your leaderboard name (no personal info needed):<br><b id="ob-name" style="font-size:1.2rem">${esc(name)}</b>
      <button class="btn sm ghost" id="ob-roll" style="margin-left:6px">🎲 New name</button></div>
  `, {
    dismissable: false,
    buttons: [{ label: "Let's play!", value: 'go' }],
    onOpen: (sheet) => {
      $('#ob-roll', sheet).onclick = () => { name = randomNickname(); $('#ob-name', sheet).textContent = name; sfx.tap(); };
    },
  });
  if (res === 'go') {
    update((d) => { d.name = name; d.onboarded = true; });
    claimDaily(true);
    startLevel(1);
  }
}

// ------------------------------------------------------------------ daily reward
function dailyStatus() {
  const s = load();
  const today = localDay();
  if (s.daily.lastClaim === today) return { canClaim: false, streak: s.daily.streak };
  const yesterday = localDay(new Date(Date.now() - 86400000));
  const streak = s.daily.lastClaim === yesterday ? s.daily.streak + 1 : 1;
  return { canClaim: true, streak };
}

function claimDaily(silent) {
  const st = dailyStatus();
  if (!st.canClaim) return null;
  const reward = DAILY_REWARDS[(st.streak - 1) % 7];
  update((d) => {
    d.daily.lastClaim = localDay();
    d.daily.streak = st.streak;
    d.shells += reward.shells || 0;
    for (const k of ['hammer', 'shuffle', 'moves']) d.boosters[k] += reward[k] || 0;
  });
  if (!silent) sfx.coin();
  return reward;
}

function rewardText(r) {
  const parts = [];
  if (r.shells) parts.push(`🐚 ${r.shells}`);
  for (const k of ['hammer', 'shuffle', 'moves']) if (r[k]) parts.push(`${BOOSTER_ICON[k]} ×${r[k]}`);
  return parts.join(' + ');
}

async function maybeDailyReward() {
  const st = dailyStatus();
  if (!st.canClaim) return;
  const day = (st.streak - 1) % 7;
  const cal = DAILY_REWARDS.map((r, i) => `<div class="day ${i < day ? 'claimed' : ''} ${i === day ? 'today' : ''}">Day ${i + 1}<span class="r">${i < day ? '✅' : r.shells && !r.hammer ? '🐚' : r.hammer && r.shells ? '🎁' : BOOSTER_ICON[Object.keys(r)[0]]}</span>${rewardText(r)}</div>`).join('');
  const res = await modal(`
    <h2>Daily Treasure</h2>
    <p class="muted">Streak: <b>🔥 ${st.streak} day${st.streak > 1 ? 's' : ''}</b>. Come back tomorrow for more!</p>
    <div class="calendar">${cal}</div>`, { buttons: [{ label: 'Claim!', value: 'claim', cls: 'green' }] });
  if (res === 'claim') {
    const r = claimDaily();
    toast(`Got ${rewardText(r)}`);
    announceAchievements();
    if (currentScreen() === 'home') goHome();
    if (currentScreen() === 'hub') showHub();
  }
}

function announceAchievements() {
  for (const a of checkAchievements()) {
    toast(`🏆 ${a.name} unlocked! +${a.reward} 🐚`);
    sfx.coin();
  }
}

// ------------------------------------------------------------------ home
function goHome() {
  leaveGame();
  setBackground(['#4fc3f7', '#1e88e5']);
  const s = load();
  const next = Math.min(highestUnlocked(s), MAX_LEVEL);
  const dKey = dayKey();
  const dd = s.dailyDive[dKey];
  const dailyTag = dd?.best !== undefined ? `<span class="tag done">✓ ${fmt(dd.best)}</span>` : dd?.log ? '<span class="tag">Resume</span>' : '<span class="tag">New!</span>';
  const deepBest = s.deep[weekKey()];
  const bd = s.blocksDaily[dKey];
  const st = dailyStatus();
  const creatures = PALETTE.map((_, i) => `<img alt="" src="${iconURL(i, 76)}">`).join('');
  const el = showScreen('home', `
    <div class="topbar">
      <button class="icon-btn" id="h-arcade" aria-label="Back to the arcade">←</button>
      <span class="pill" title="Shells">🐚 ${fmt(s.shells)}</span>
      <span class="pill" title="Stars">⭐ ${totalStars(s)}</span>
      <span class="pill" title="Login streak">🔥 ${s.daily.streak}</span>
      <span class="spacer"></span>
      <button class="icon-btn ${st.canClaim ? 'badge-dot' : ''}" id="h-gift" aria-label="Daily treasure">🎁</button>
      <button class="icon-btn" id="h-settings" aria-label="Settings">⚙️</button>
    </div>
    <div class="scroll">
      <div class="home-hero">
        <div class="logo">Tide<span>pop</span></div>
        <div class="creatures">${creatures}</div>
      </div>
      <button class="btn wide play-big" id="h-play">▶ Play Level ${next}</button>
      <div class="mode-grid">
        <button class="card" id="h-map"><span class="emoji">🗺️</span><b>Adventure</b><span class="sub">Endless levels · new worlds every 10</span></button>
        <button class="card" id="h-daily">${dailyTag}<span class="emoji">📅</span><b>Daily Dive</b><span class="sub">Same board for everyone today</span></button>
        <button class="card" id="h-deep">${deepBest ? `<span class="tag done">${fmt(deepBest)}</span>` : ''}<span class="emoji">🐋</span><b>Deep Dive</b><span class="sub">Endless weekly challenge</span></button>
        <button class="card" id="h-blocks">${bd !== undefined ? `<span class="tag done">${fmt(bd)}</span>` : ''}<span class="emoji">🧱</span><b>Reef Blocks</b><span class="sub">Block puzzle · best ${fmt(s.blocks.best)}</span></button>
        <button class="card" id="h-lb"><span class="emoji">🏆</span><b>Leaderboards</b><span class="sub">Verified, fair scores</span></button>
        <button class="card" id="h-ach"><span class="emoji">🎖️</span><b>Achievements</b><span class="sub">${Object.keys(s.achievements).length}/${ACHIEVEMENTS.length} unlocked</span></button>
        <button class="card" id="h-shop"><span class="emoji">🛍️</span><b>Shell Shop</b><span class="sub">Boosters for shells – never real money</span></button>
        <button class="card" id="h-help"><span class="emoji">❓</span><b>How to play</b><span class="sub">Specials, combos & tips</span></button>
      </div>
      <p class="center small muted" style="margin-top:16px">Playing as <b>${esc(s.name)}</b> · free & ad-free</p>
    </div>`);
  const on = (id, fn) => { $(id, el).onclick = () => { sfx.tap(); fn(); }; };
  on('#h-play', () => startLevel(next));
  on('#h-arcade', showHub);
  on('#h-map', showMap);
  on('#h-daily', startDaily);
  on('#h-deep', startDeep);
  on('#h-blocks', blocksMenu);
  on('#h-lb', () => showLeaderboard());
  on('#h-ach', showAchievements);
  on('#h-shop', showShop);
  on('#h-help', howToPlay);
  on('#h-settings', showSettings);
  on('#h-gift', () => (dailyStatus().canClaim ? maybeDailyReward() : toast('Already claimed today – see you tomorrow! 🔥')));
}

// ------------------------------------------------------------------ map
function showMap(scrollTo) {
  leaveGame();
  const s = load();
  const unlocked = highestUnlocked(s);
  let html = '';
  // show every world up to the one after the player's current world
  const worldsShown = Math.min(Math.ceil(MAX_LEVEL / 10), Math.max(LEVEL_COUNT / 10, Math.floor((unlocked - 1) / 10) + 2));
  for (let w = 0; w < worldsShown; w++) {
    let stars = 0;
    for (let n = w * 10 + 1; n <= w * 10 + 10; n++) stars += s.levels[n]?.stars || 0;
    const info = worldOf(w * 10 + 1);
    html += `<div class="world-banner" style="background:linear-gradient(90deg,${info.bg[1]}cc,${info.bg[0]}66)"><b>${w + 1}. ${esc(info.name)}</b><span>⭐ ${stars}/30</span></div>`;
    for (let n = w * 10 + 1; n <= w * 10 + 10; n++) {
      const off = Math.round(Math.sin(n * 0.9) * 90);
      const lv = s.levels[n];
      const locked = n > unlocked;
      const cls = ['level-node', n % 10 === 0 ? 'boss' : '', locked ? 'locked' : '', n === unlocked ? 'current' : ''].join(' ');
      html += `<div class="level-row"><button class="${cls}" data-n="${n}" style="transform:translateX(${off}px)" ${locked ? 'aria-disabled="true"' : ''} aria-label="Level ${n}${locked ? ' locked' : ''}">
        ${locked ? '🔒' : n}${lv?.stars ? `<span class="stars">${starsHtml(lv.stars)}</span>` : ''}</button></div>`;
    }
  }
  const el = showScreen('map', `
    <div class="topbar">
      <button class="icon-btn" id="m-back" aria-label="Back">←</button>
      <h2 class="grow">Adventure</h2>
      <span class="pill">⭐ ${totalStars(s)}</span>
    </div>
    <div class="scroll"><div class="map">${html}<p class="center muted small">🌊 The reef goes on forever – a new world opens every 10 levels!</p></div></div>`);
  $('#m-back', el).onclick = () => { sfx.tap(); goHome(); };
  for (const b of $$('.level-node', el)) {
    b.onclick = () => {
      const n = Number(b.dataset.n);
      if (n > unlocked) { toast('Win the previous level to unlock this one'); sfx.bad(); return; }
      sfx.tap();
      startLevel(n);
    };
  }
  const target = $(`.level-node[data-n="${scrollTo || unlocked}"]`, el);
  target?.scrollIntoView({ block: 'center' });
}

// ------------------------------------------------------------------ goals
function goalHtml(o, big) {
  const val = (cur, tgt) => (big ? fmt(tgt) : `${fmt(Math.max(0, tgt - cur))}`);
  switch (o.type) {
    case 'collect': return `<div class="goal ${o.done ? 'done' : ''}"><img alt="${PALETTE[o.color].name}" src="${iconURL(o.color, 64)}">${o.done ? '✓' : val(o.current || 0, o.count)}</div>`;
    case 'jelly': return `<div class="goal ${o.done ? 'done' : ''}"><span class="gi" aria-label="Algae">🌿</span>${o.done ? '✓' : big ? 'Clean all' : o.left}</div>`;
    case 'crate': return `<div class="goal ${o.done ? 'done' : ''}"><span class="gi" aria-label="Crates">📦</span>${o.done ? '✓' : big ? 'Break all' : o.left}</div>`;
    case 'score': return `<div class="goal ${o.done ? 'done' : ''}"><span class="gi" aria-label="Score">🎯</span>${fmt(o.target)}</div>`;
    default: return '';
  }
}

function levelTips(n) {
  const tips = {
    1: 'Swipe (or tap two) neighbouring creatures to swap them. Line up <b>3 or more</b> of the same kind!',
    2: 'Match <b>4 in a line</b> to make a <b>Wave</b> 🌊 that clears a whole row or column.',
    3: 'Match in an <b>L or T</b> shape to make a <b>Bubble Bomb</b> 🫧. Match <b>5 in a line</b> for a <b>Pearl</b> 🦪!',
    4: 'New goal: <b>collect</b> the creatures shown by matching them.',
    6: 'New goal: <b>clean the algae</b> 🌿 by making matches on top of it.',
    9: 'Tip: swap two special pieces together for a giant combo!',
    11: 'New goal: <b>break the barnacle crates</b> 📦 by matching next to them or blasting them.',
    16: 'Some crates are tough: they show how many hits they need.',
  };
  return tips[n] ? `<div class="tip">💡 ${tips[n]}</div>` : '';
}

// ------------------------------------------------------------------ match modes
async function startLevel(n) {
  leaveGame();
  const cfg = getLevel(n, randSeed());
  const world = worldOf(n);
  setBackground(world.bg);
  const best = load().levels[n];
  const goals = new Game({ ...cfg }).objectiveProgress();
  const res = await modal(`
    <h2>${world.boss ? '👑 ' : ''}Level ${n}</h2>
    <p class="muted small">${esc(world.name)}${n % 10 === 1 && n > 1 && !best ? ' · <b>new world!</b>' : ''}${best?.stars ? ` · best ${starsHtml(best.stars)}` : ''}</p>
    <div class="goal-list">${goals.map((g) => goalHtml(g, true)).join('')}</div>
    <p><b>${cfg.moves}</b> moves</p>
    ${levelTips(n)}`, { buttons: [{ label: '▶ Play', value: 'play', cls: 'green' }, { label: 'Back', value: 'back', cls: 'ghost' }], row: true });
  if (res !== 'play') { if (currentScreen() !== 'map') showMap(n); return; }
  playMatch({ kind: 'level', n, cfg });
}

async function startDaily() {
  const key = dayKey();
  const s = load();
  const entry = s.dailyDive[key];
  const cfg = dailyConfig(key);
  if (entry?.best !== undefined) {
    const r = await modal(`<h2>Daily Dive</h2><p>You scored <b class="big-score">${fmt(entry.best)}</b> today.</p>
      <p class="muted small">Your first finished dive is the one that counts. You can keep practising – practice scores aren't ranked.</p>`,
    { buttons: [{ label: '🏆 Leaderboard', value: 'lb', cls: 'blue' }, { label: 'Practice', value: 'practice', cls: 'ghost' }, { label: 'Close', value: null, cls: 'ghost' }] });
    if (r === 'lb') showLeaderboard('daily');
    else if (r === 'practice') playMatch({ kind: 'daily', key, cfg, practice: true });
    return;
  }
  if (entry?.log) return playMatch({ kind: 'daily', key, cfg, resumeLog: entry.log });
  const r = await modal(`<h2>📅 Daily Dive</h2><p>Everyone on Earth gets <b>the same board</b> today.</p>
    <p><b>25 moves</b> – score as much as you can. Algae 🌿 gives bonus points.</p>
    <div class="tip">Your <b>first finished dive</b> goes on the leaderboard – make it count! If you leave, you'll resume where you were. New board at 00:00 UTC.</div>`,
  { buttons: [{ label: '▶ Dive in', value: 'go', cls: 'green' }, { label: 'Later', value: null, cls: 'ghost' }], row: true });
  if (r === 'go') playMatch({ kind: 'daily', key, cfg });
}

async function startDeep() {
  const key = weekKey();
  const r = await modal(`<h2>🐋 Deep Dive</h2><p>This week's endless board. Start with <b>20 moves</b>.</p>
    <div class="tip">Every special piece you make gives <b>+1 move</b> (Pearls give +2), and big cascades give bonus moves too. How deep can you go?</div>
    <p class="muted small">Best score this week counts · new board every Monday (UTC) · ${load().deep[key] ? `your best: <b>${fmt(load().deep[key])}</b>` : 'no score yet'}</p>`,
  { buttons: [{ label: '▶ Dive', value: 'go', cls: 'green' }, { label: '🏆', value: 'lb', cls: 'blue' }], row: true });
  if (r === 'go') playMatch({ kind: 'deep', key, cfg: deepConfig(key) });
  else if (r === 'lb') showLeaderboard('deep');
}

function playMatch(run) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  let game;
  if (run.resumeLog) {
    const r = replay(run.cfg, run.resumeLog, { maxBoosters: 0 });
    game = r.ok ? r.game : new Game(run.cfg);
    if (r.ok) toast('Resumed your dive');
  } else game = new Game(run.cfg);
  run.game = game;
  const isLevel = run.kind === 'level';
  const title = isLevel ? `Level ${run.n}` : run.kind === 'daily' ? `Daily Dive ${run.practice ? '(practice)' : ''}` : 'Deep Dive';
  if (!isLevel) setBackground(run.kind === 'daily' ? ['#ffb07c', '#d1495b'] : ['#3d5afe', '#0d1638']);
  const s = load();
  const el = showScreen('match', `
    <div class="hud">
      <button class="icon-btn" id="g-pause" aria-label="Pause">⏸</button>
      <div class="box goals" id="g-goals"></div>
      <div class="box moves" id="g-moves-box"><span class="n" id="g-moves">0</span><span class="lbl">moves</span></div>
    </div>
    <div class="scorebar">
      <div class="score" id="g-score">0</div>
      ${isLevel ? '<div class="meter" id="g-meter"><div class="fill"></div></div>' : `<div class="grow mode-label">${esc(title)}</div>`}
    </div>
    <div class="board-wrap"><canvas id="g-canvas" aria-label="Game board. Use arrow keys and Enter to play."></canvas>${run.n === 1 && !s.levels[1] ? '<div class="coach" id="g-coach">👆 Swipe a creature to swap it with a neighbour – make a line of 3!</div>' : ''}</div>
    ${isLevel ? `<div class="boosters">
      <button class="booster" data-b="hammer" aria-label="Hammer booster">🔨<span class="cnt"></span></button>
      <button class="booster" data-b="shuffle" aria-label="Shuffle booster">🔀<span class="cnt"></span></button>
      <button class="booster" data-b="moves" aria-label="Plus five moves booster">➕<span class="cnt"></span></button>
      <button class="booster" data-b="hint" aria-label="Show a hint">💡</button>
    </div>` : '<div class="boosters"><button class="booster" data-b="hint" aria-label="Show a hint">💡</button></div>'}`);

  const refreshHud = (score = game.score) => {
    $('#g-score', el).textContent = fmt(score);
    $('#g-moves', el).textContent = game.movesLeft;
    $('#g-moves-box', el).classList.toggle('low', game.movesLeft <= 3 && game.state === 'playing');
    const prog = game.objectiveProgress();
    $('#g-goals', el).innerHTML = prog.length ? prog.map((g) => goalHtml(g)).join('') : `<span class="lbl">${esc(title)}</span>`;
    if (isLevel) {
      const t = run.cfg.stars;
      const max = t[2] * 1.1;
      $('#g-meter .fill', el).style.width = `${Math.min(100, (score / max) * 100)}%`;
      const meter = $('#g-meter', el);
      if (!meter.dataset.marks) {
        meter.dataset.marks = '1';
        for (let i = 0; i < 3; i++) meter.insertAdjacentHTML('beforeend', `<span class="mark" style="left:${(t[i] / max) * 100}%">★</span>`);
      }
      $$('.mark', meter).forEach((m, i) => m.classList.toggle('star-on', score >= t[i]));
    }
    for (const b of $$('.booster[data-b]', el)) {
      const k = b.dataset.b;
      if (k === 'hint') continue;
      const n = load().boosters[k];
      $('.cnt', b).textContent = n > 0 ? n : '🐚';
    }
  };

  view = new MatchView($('#g-canvas', el), game, {
    reducedMotion: s.settings.reducedMotion,
    onUpdate: (score) => refreshHud(score),
    onInvalid: () => {},
    onSettled: () => {
      $('#g-coach', el)?.remove();
      if (run.kind === 'daily' && !run.practice) update((d) => { d.dailyDive[run.key] = { log: game.log }; });
      if (game.state !== 'playing') setTimeout(() => endMatch(run), 350);
    },
    onCellTap: (cell) => {
      if (view.mode === 'hammer') {
        const r = game.hammer(cell[0], cell[1]);
        setBoosterMode(null);
        if (r.ok) {
          useBooster('hammer');
          view.play(r.steps);
        }
      }
    },
  });
  refreshHud();
  if (run.n === 1 && !s.levels[1]) setTimeout(() => view?.showHint(true), 800);

  const setBoosterMode = (mode) => {
    view.mode = mode || 'swap';
    for (const b of $$('.booster', el)) b.classList.toggle('active', b.dataset.b === mode);
    if (mode === 'hammer') toast('Tap a piece or crate to smash it');
  };
  const useBooster = (k) => {
    update((d) => {
      if (d.boosters[k] > 0) d.boosters[k]--;
      else d.shells -= SHOP.find((x) => x.id === k).price;
    });
    refreshHud();
  };
  const canAfford = (k) => load().boosters[k] > 0 || load().shells >= SHOP.find((x) => x.id === k).price;

  $('#g-pause', el).onclick = () => { sfx.tap(); pauseMenu(); };
  for (const b of $$('.booster', el)) {
    b.onclick = async () => {
      if (view.busy || game.state !== 'playing') return;
      const k = b.dataset.b;
      sfx.tap();
      if (k === 'hint') { view.showHint(true); return; }
      if (view.mode === k) { setBoosterMode(null); return; }
      if (!canAfford(k)) { toast(`Not enough shells – earn more by winning levels!`); return; }
      if (load().boosters[k] <= 0) {
        const price = SHOP.find((x) => x.id === k).price;
        const ok = await modal(`<h2>${BOOSTER_ICON[k]} Use for ${price} 🐚?</h2><p class="muted">You're out of this booster. Spend shells you've earned?</p>`,
          { buttons: [{ label: `Yes (🐚 ${price})`, value: true }, { label: 'No', value: false, cls: 'ghost' }], row: true });
        if (!ok) return;
      }
      if (k === 'hammer') setBoosterMode('hammer');
      else if (k === 'shuffle') { useBooster('shuffle'); view.play(game.shuffleBooster().steps); }
      else if (k === 'moves') { useBooster('moves'); game.addMoves(5); refreshHud(); toast('+5 moves!'); sfx.coin(); }
    };
  }
  currentRun = run;
}

let currentRun = null;

async function pauseMenu() {
  if (!view) return;
  const s = load();
  const run = currentRun;
  const r = await modal(`<h2>Paused</h2>
    <div class="setting"><span>🔊 Sound effects</span><button class="switch" role="switch" data-k="sfx" aria-checked="${s.settings.sfx}"></button></div>
    <div class="setting"><span>🎵 Music</span><button class="switch" role="switch" data-k="music" aria-checked="${s.settings.music}"></button></div>`, {
    buttons: [
      { label: '▶ Resume', value: 'resume', cls: 'green' },
      ...(run?.kind === 'level' || run?.kind === 'deep' || run?.practice || run?.kind === 'blocks' || run?.kind === 'arcade' ? [{ label: '↻ Restart', value: 'restart', cls: 'blue' }] : []),
      { label: '❓ How to play', value: 'help', cls: 'ghost' },
      { label: run?.kind === 'daily' && !run.practice ? '🏠 Home (progress saved)' : '🏠 Quit to home', value: 'quit', cls: 'ghost' },
    ],
    onOpen: (sheet) => wireSwitches(sheet),
  });
  if (r === 'restart') {
    if (run.kind === 'level') startLevel(run.n);
    else if (run.kind === 'deep') playMatch({ kind: 'deep', key: run.key, cfg: deepConfig(run.key) });
    else if (run.kind === 'daily') playMatch({ kind: 'daily', key: run.key, cfg: run.cfg, practice: true });
    else if (run.kind === 'blocks') { update((d) => { d.blocksRun = null; }); playBlocks({ daily: run.daily }); }
    else if (run.kind === 'arcade') playArcade(run.id, { daily: run.daily });
  } else if (r === 'help') { if (run?.kind === 'arcade') await arcadeHow(run.id); else await howToPlay(); pauseMenu(); }
  else if (r === 'quit') {
    if (run?.kind === 'level') showMap(run.n);
    else if (run?.kind === 'blocks' || run?.kind === 'arcade') showHub();
    else goHome();
  }
}

function recordMatchStats(game) {
  update((d) => {
    d.stats.gamesPlayed++;
    d.stats.specials += game.stats.specialsMade;
    d.stats.rainbows += game.stats.rainbowsMade;
    d.stats.bestCascade = Math.max(d.stats.bestCascade, game.stats.maxCascade);
  });
}

async function endMatch(run) {
  const game = run.game;
  if (run.ended) return;
  if (run.kind === 'level') return endLevel(run);
  run.ended = true;
  recordMatchStats(game);
  noteGameEnd('tidepop', run.kind === 'deep' && game.score > (load().deep[run.key] || 0));
  const score = game.score;
  let rankLine = '<p class="muted small" id="r-rank">Checking leaderboard…</p>';
  let ranked = false;
  let isBest = false;
  if (run.kind === 'daily') {
    if (!run.practice) {
      ranked = true;
      update((d) => { d.dailyDive[run.key] = { best: score, ranked: true }; });
    } else rankLine = '<p class="muted small">Practice run – not ranked.</p>';
  } else {
    const prev = load().deep[run.key] || 0;
    isBest = score > prev;
    if (isBest) update((d) => { d.deep[run.key] = score; });
    ranked = true;
  }
  const shells = Math.min(40, 5 + Math.floor(score / 2500));
  update((d) => { d.shells += shells; });
  sfx.win();
  announceAchievements();
  const share = run.kind === 'daily' && !run.practice;
  const p = modal(`<h2>${run.kind === 'daily' ? '📅 Daily Dive' : '🐋 Deep Dive'} complete!</h2>
    <div class="big-score">${fmt(score)}</div>
    ${isBest ? '<p>🎉 New weekly best!</p>' : ''}
    ${run.kind === 'deep' ? `<p class="muted small">${game.movesMade} moves played · ${game.stats.bonusMovesEarned} bonus moves earned</p>` : ''}
    <div class="reward">+${shells} 🐚</div>
    ${rankLine}`, {
    buttons: [
      ...(share ? [{ label: '📤 Share', value: 'share', cls: 'blue' }] : []),
      { label: '🏆 Leaderboard', value: 'lb', cls: share ? 'ghost' : 'blue' },
      ...(run.kind === 'deep' ? [{ label: '↻ Dive again', value: 'again', cls: 'green' }] : []),
      { label: '🏠 Home', value: 'home', cls: 'ghost' },
    ],
    dismissable: false,
  });
  let rank = null;
  if (ranked) {
    submitRun({ board: run.kind === 'daily' ? 'daily' : 'deep', key: run.key, log: game.log, score })
      .then((res) => {
        rank = res?.rank;
        const el = $('#r-rank');
        if (!el) return;
        if (res?.queued) el.textContent = "You're offline – your score will be submitted when you reconnect.";
        else if (res?.skipped) el.textContent = 'Leaderboard is turned off in settings.';
        else if (res?.rank) el.innerHTML = `World rank: <b>#${res.rank}</b>${run.kind === 'deep' && res.best ? ` · weekly best ${fmt(res.best)}` : ''}`;
        else el.textContent = res?.error || '';
      });
  }
  const r = await p;
  if (r === 'share') {
    await shareText(`🐚 Tidepop Daily Dive ${run.key}\nScore: ${fmt(score)}${rank ? ` · Rank #${rank}` : ''}\nCan you beat me? ${location.origin}${location.pathname}`);
    goHome();
  } else if (r === 'lb') showLeaderboard(run.kind === 'daily' ? 'daily' : 'deep');
  else if (r === 'again') playMatch({ kind: 'deep', key: run.key, cfg: deepConfig(run.key) });
  else goHome();
}

async function submitRun(entry) {
  try {
    return await api.submit({ ...entry, v: ENGINE_VERSION });
  } catch (e) {
    return { error: e.status === 409 ? 'A game update is available – reload to submit scores.' : `Couldn't submit: ${e.message}` };
  }
}

async function endLevel(run) {
  const game = run.game;
  const n = run.n;
  if (game.state === 'lost') {
    sfx.lose();
    const prog = game.objectiveProgress().filter((o) => !o.done);
    const s = load();
    const haveMoves = s.boosters.moves > 0;
    const affordable = haveMoves || s.shells >= 50;
    const r = await modal(`<h2>Out of moves!</h2>
      <p class="muted">So close! Still needed:</p>
      <div class="goal-list">${prog.map((g) => goalHtml(g)).join('')}</div>`, {
      dismissable: false,
      buttons: [
        ...(affordable ? [{ label: haveMoves ? `➕ 5 moves (have ${s.boosters.moves})` : '➕ 5 moves for 🐚 50', value: 'more', cls: 'green' }] : []),
        { label: '↻ Try again', value: 'retry', cls: 'blue' },
        { label: '🗺️ Map', value: 'map', cls: 'ghost' },
      ],
    });
    if (r === 'more') {
      update((d) => { if (d.boosters.moves > 0) d.boosters.moves--; else d.shells -= 50; });
      game.addMoves(5);
      view.hooks.onUpdate(game.score);
      return;
    }
    run.ended = true;
    recordMatchStats(game);
    if (r === 'retry') startLevel(n);
    else showMap(n);
    return;
  }
  run.ended = true;
  recordMatchStats(game);
  noteGameEnd('tidepop', game.score > (load().levels[n]?.best || 0));
  const stars = game.stars();
  const prev = load().levels[n];
  const prevStars = prev?.stars || 0;
  let shells = prevStars === 0 ? 10 + stars * 5 : Math.max(0, stars - prevStars) * 5;
  let gift = null;
  if (prevStars === 0 && n % 5 === 0) gift = ['hammer', 'shuffle', 'moves'][(n / 5) % 3];
  update((d) => {
    d.levels[n] = { stars: Math.max(prevStars, stars), best: Math.max(prev?.best || 0, game.score) };
    d.shells += shells;
    if (prevStars === 0) d.stats.levelsWon++;
    if (gift) d.boosters[gift]++;
  });
  sfx.win();
  haptic(50);
  announceAchievements();
  submitRun({ board: 'stars', level: n, seed: run.cfg.seed, log: game.log });
  const next = Math.min(n + 1, MAX_LEVEL);
  const worldEnd = n % 10 === 0;
  const p = modal(`<h2>${worldEnd ? '👑 World complete!' : 'Level complete!'}</h2>
    <div class="big-stars">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'star-on' : 'star-off'}">★</span>`).join('')}</div>
    <div class="big-score">${fmt(game.score)}</div>
    ${prev?.best && game.score > prev.best ? '<p>🎉 New best!</p>' : ''}
    ${shells ? `<div class="reward">+${shells} 🐚</div>` : ''}${gift ? `<div class="reward">🎁 ${BOOSTER_ICON[gift]} +1</div>` : ''}
    ${worldEnd ? `<p>Next stop: <b>${esc(worldOf(next).name)}</b></p>` : ''}`, {
    dismissable: false,
    buttons: [
      ...(n < MAX_LEVEL ? [{ label: `▶ Level ${next}`, value: 'next', cls: 'green' }] : []),
      { label: '↻ Replay', value: 'retry', cls: 'blue' },
      { label: '🗺️ Map', value: 'map', cls: 'ghost' },
    ],
    row: false,
  });
  // star reveal animation
  $$('.big-stars span').forEach((sp, i) => setTimeout(() => { sp.classList.add('show'); if (i < stars) sfx.star(i); }, 250 + i * 280));
  const r = await p;
  if (r === 'next') startLevel(next);
  else if (r === 'retry') startLevel(n);
  else showMap(next);
}

// ------------------------------------------------------------------ arcade hub
const VIEWS = {
  miner: () => import('./arcade/miner-view.js'),
  puffer: () => import('./arcade/puffer-view.js'),
  serpent: () => import('./arcade/serpent-view.js'),
  merge: () => import('./arcade/merge-view.js'),
  stack: () => import('./arcade/stack-view.js'),
  sort: () => import('./arcade/sort-view.js'),
};

function arcadeStats(id) {
  const a = load().arcade || {};
  return { best: 0, games: 0, daily: {}, ...(a[id] || {}) };
}

function hubGames() {
  const s = load();
  return [
    { id: 'tidepop', title: 'Tidepop', icon: '🐚', tagline: 'Match-3 adventure · endless levels', best: `⭐ ${totalStars(s)}`, played: s.dailyDive[dayKey()]?.best !== undefined, dailyBoard: 'daily', open: goHome },
    { id: 'reef', title: 'Reef Blocks', icon: '🧱', tagline: 'Drag blocks, clear lines, chain combos', best: fmt(s.blocks.best), played: s.blocksDaily[dayKey()] !== undefined, dailyBoard: 'blocksDaily', open: blocksMenu },
    ...ARCADE.map((g) => {
      const st = arcadeStats(g.id);
      return { id: g.id, title: g.title, icon: g.icon, tagline: g.tagline, best: fmt(st.best), played: st.daily[dayKey()] !== undefined, dailyBoard: g.id + 'Daily', open: () => arcadeMenu(g.id) };
    }),
  ];
}

function hotGameId() {
  const ids = hubGames().map((g) => g.id);
  return ids[hashString('hot-' + dayKey()) % ids.length];
}

function missionState() {
  const s = load();
  const day = dayKey();
  return s.missions?.day === day ? s.missions : { day, best: 0, hot: 0, claimed: false };
}

function missions() {
  const m = missionState();
  const games = hubGames();
  const hot = games.find((g) => g.id === hotGameId());
  const dailies = games.filter((g) => g.played).length;
  return {
    claimed: m.claimed,
    list: [
      { text: 'Play 3 daily challenges', cur: Math.min(3, dailies), goal: 3 },
      { text: 'Beat one of your personal bests', cur: Math.min(1, m.best), goal: 1 },
      { text: `Play today's hot game: ${hot.icon} ${hot.title}`, cur: Math.min(1, m.hot), goal: 1 },
    ],
  };
}

/** Records a finished game for missions; returns true if it was the hot game (2x shells). */
function noteGameEnd(id, isBest) {
  const hot = id === hotGameId();
  update((d) => {
    const day = dayKey();
    if (d.missions?.day !== day) d.missions = { day, best: 0, hot: 0, claimed: false };
    if (isBest) d.missions.best++;
    if (hot) d.missions.hot++;
    d.played ||= {};
    d.played[id] = (d.played[id] || 0) + 1;
  });
  return hot;
}

function msToReset() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}
const hms = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
let hubTimer = null;

function showHub() {
  leaveGame();
  setBackground(['#4fc3f7', '#283593']);
  const s = load();
  const games = hubGames();
  const hot = games.find((g) => g.id === hotGameId());
  const ms = missions();
  const allDone = ms.list.every((m) => m.cur >= m.goal);
  const st = dailyStatus();
  const ranks = s.lastRanks || {};
  const el = showScreen('hub', `
    <div class="topbar">
      <span class="pill" title="Shells">🐚 ${fmt(s.shells)}</span>
      <span class="pill" title="Login streak">🔥 ${s.daily.streak}</span>
      <span class="spacer"></span>
      <button class="icon-btn" id="u-lb" aria-label="Leaderboards">🏆</button>
      <button class="icon-btn ${st.canClaim ? 'badge-dot' : ''}" id="u-gift" aria-label="Daily treasure">🎁</button>
      <button class="icon-btn" id="u-settings" aria-label="Settings">⚙️</button>
    </div>
    <div class="scroll">
      <div class="home-hero"><div class="logo">Tide<span>pop</span> <small class="arcade-word">Arcade</small></div></div>
      <div class="hub-timer" role="timer">⏳ Today's challenges end in <b id="u-timer">${hms(msToReset())}</b></div>
      <button class="hot-card" id="u-hot"><span class="hot-flame">🔥</span><span class="grow"><small>HOT TODAY · 2× SHELLS</small><b>${hot.icon} ${esc(hot.title)}</b></span><span class="btn sm">Play</span></button>
      <div class="missions">
        <div class="row"><b class="grow">🎯 Daily missions</b><span class="small muted">reward: 🐚 150 + 🎁</span></div>
        ${ms.list.map((m) => `<div class="mission ${m.cur >= m.goal ? 'done' : ''}"><span>${m.cur >= m.goal ? '✅' : '⬜'} ${esc(m.text)}</span><span class="small">${m.cur}/${m.goal}</span></div>`).join('')}
        ${ms.claimed ? '<p class="small muted center">Chest claimed – new missions at reset!</p>' : `<button class="btn wide ${allDone ? 'green' : 'ghost'}" id="u-chest" ${allDone ? '' : 'disabled'}>${allDone ? '🎁 Open the mission chest' : 'Complete all 3 to open the chest'}</button>`}
      </div>
      <div class="game-grid">${games.map((g) => {
        const rk = ranks[g.dailyBoard + ':' + dayKey()];
        return `<button class="game-card ${g.id === hot.id ? 'hot' : ''}" data-g="${g.id}">
          ${g.id === hot.id ? '<span class="tag">🔥 2×</span>' : g.played ? `<span class="tag done">${rk ? '#' + rk : '✓'} today</span>` : '<span class="tag">Daily!</span>'}
          <span class="game-icon">${g.icon}</span><b>${esc(g.title)}</b><span class="sub">${esc(g.tagline)}</span><span class="sub">Best: <b>${g.best}</b></span></button>`;
      }).join('')}</div>
      <p class="center small muted" style="margin-top:14px">${games.length} games · free forever · no ads · playing as <b>${esc(s.name)}</b></p>
    </div>`);
  const on = (id, fn) => { const b = $(id, el); if (b) b.onclick = () => { sfx.tap(); fn(); }; };
  on('#u-lb', () => showLeaderboard());
  on('#u-settings', showSettings);
  on('#u-gift', () => (dailyStatus().canClaim ? maybeDailyReward() : toast('Already claimed today – see you tomorrow! 🔥')));
  on('#u-hot', () => hot.open());
  on('#u-chest', () => {
    update((d) => { d.missions = { ...missionState(), claimed: true }; d.shells += 150; d.boosters.hammer++; d.boosters.moves++; });
    sfx.win();
    toast('Mission chest: +150 🐚, 🔨 +1, ➕ +1');
    announceAchievements();
    showHub();
  });
  for (const b of $$('.game-card', el)) b.onclick = () => { sfx.tap(); games.find((g) => g.id === b.dataset.g).open(); };
  clearInterval(hubTimer);
  hubTimer = setInterval(() => {
    const t = $('#u-timer');
    if (!t || currentScreen() !== 'hub') { clearInterval(hubTimer); return; }
    const left = msToReset();
    t.textContent = hms(left);
    if (left < 3600000) t.parentElement.classList.add('urgent');
  }, 1000);
  checkRankAlerts(games);
}

let rankCheckAt = 0;
/** FOMO: tell players when someone overtook them on a daily board. */
async function checkRankAlerts(games) {
  if (Date.now() - rankCheckAt < 60000 || !load().settings.leaderboard) return;
  rankCheckAt = Date.now();
  const key = dayKey();
  for (const g of games.filter((x) => x.played)) {
    try {
      const data = await api.top(g.dailyBoard, key);
      if (!data.me) continue;
      const id = g.dailyBoard + ':' + key;
      const prev = load().lastRanks?.[id];
      update((d) => { d.lastRanks = { ...(d.lastRanks || {}), [id]: data.me.rank }; });
      if (prev && data.me.rank > prev) {
        toast(`📉 ${data.me.rank - prev} player${data.me.rank - prev > 1 ? 's' : ''} passed you in ${g.title}! You're #${data.me.rank} – win it back!`);
        sfx.bad();
      }
      const tag = $(`.game-card[data-g="${g.id}"] .tag.done`);
      if (tag) tag.textContent = `#${data.me.rank} today`;
    } catch {
      return; // offline / signed out – skip quietly
    }
  }
}

async function arcadeHow(id) {
  const mod = await VIEWS[id]();
  return modal(`<h2>${ARCADE_BY_ID[id].icon} How to play</h2>${mod.HOW}`, { buttons: [{ label: 'Got it!', value: true }] });
}

async function arcadeMenu(id) {
  const g = ARCADE_BY_ID[id];
  const st = arcadeStats(id);
  const today = st.daily[dayKey()];
  const hot = id === hotGameId();
  const r = await modal(`<h2>${g.icon} ${esc(g.title)}</h2>
    <p class="muted">${esc(g.tagline)}</p>
    ${hot ? '<div class="reward">🔥 Hot today: 2× shells</div>' : ''}
    <p class="small muted">Your best: <b>${fmt(st.best)}</b> · Today's daily: <b>${today !== undefined ? fmt(today) : 'not played'}</b></p>
    <div class="tip">📅 The <b>daily challenge</b> is the same for every player today. Best score of the day wins – it ends in <b>${hms(msToReset())}</b>.</div>`, {
    buttons: [
      { label: '▶ Play', value: 'play', cls: 'green' },
      { label: `📅 Daily challenge${today === undefined ? ' (new!)' : ''}`, value: 'daily', cls: 'blue' },
      { label: '🏆 Leaderboard', value: 'lb', cls: 'ghost' },
      { label: '❓ How to play', value: 'how', cls: 'ghost' },
    ],
  });
  if (r === 'play') playArcade(id, { daily: false });
  else if (r === 'daily') playArcade(id, { daily: true });
  else if (r === 'lb') showLeaderboard(id + 'Daily');
  else if (r === 'how') { await arcadeHow(id); arcadeMenu(id); }
}

async function playArcade(id, { daily }) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  const g = ARCADE_BY_ID[id];
  const mod = await VIEWS[id]();
  const key = dayKey();
  const runSeed = randSeed();
  const sim = g.create(arcadeSeed(id, daily, key, runSeed));
  const run = { kind: 'arcade', id, daily, key, seed: runSeed, sim };
  currentRun = run;
  setBackground(g.color);
  const s = load();
  const el = showScreen('arcade', `
    <div class="hud">
      <button class="icon-btn" id="ar-pause" aria-label="Pause">⏸</button>
      <div class="box grow arcade-hud" id="ar-hud"></div>
    </div>
    <div class="board-wrap"><canvas id="ar-canvas" aria-label="${esc(g.title)} game area"></canvas></div>
    <div id="ar-controls" class="arcade-controls"></div>
    <div class="mode-label">${daily ? `📅 Daily challenge · ends in ${hms(msToReset())}` : `${g.icon} ${esc(g.title)} · best ${fmt(arcadeStats(id).best)}`}</div>`);
  const refresh = () => {
    const box = $('#ar-hud', el);
    if (box) box.innerHTML = mod.hud(sim).map((h) => `<div class="hstat ${h.warn ? 'warn' : ''} ${h.big ? 'big' : ''}"><span class="lbl">${esc(h.label)}</span><b>${h.value}</b></div>`).join('');
  };
  view = new mod.default({
    canvas: $('#ar-canvas', el),
    controls: $('#ar-controls', el),
    sim,
    reducedMotion: s.settings.reducedMotion,
    hooks: {
      onChange: refresh,
      onOver: () => endArcade(run),
      onQuit: async () => {
        const ok = await modal('<h2>End this run?</h2><p>Your score so far will be saved and submitted.</p>', { buttons: [{ label: 'End run', value: true, cls: 'green' }, { label: 'Keep playing', value: false, cls: 'ghost' }], row: true });
        if (ok && !sim.over) { sim.quit(); endArcade(run); }
      },
    },
  });
  $('#ar-pause', el).onclick = () => { sfx.tap(); pauseMenu(); };
  refresh();
  if (!arcadeStats(id).games) arcadeHow(id);
}

async function endArcade(run) {
  if (run.ended) return;
  run.ended = true;
  const g = ARCADE_BY_ID[run.id];
  const score = run.sim.score;
  const prev = arcadeStats(run.id);
  const prevBest = run.daily ? prev.daily[run.key] || 0 : prev.best;
  const isBest = score > prev.best;
  const hot = noteGameEnd(run.id, isBest);
  const shells = Math.min(60, 2 + Math.floor(score / g.shellsPer)) * (hot ? 2 : 1);
  update((d) => {
    d.arcade ||= {};
    const a = { best: 0, games: 0, daily: {}, ...(d.arcade[run.id] || {}) };
    a.games++;
    a.best = Math.max(a.best, score);
    if (run.daily) a.daily = { ...a.daily, [run.key]: Math.max(a.daily[run.key] || 0, score) };
    // keep only the last 30 days of daily scores
    for (const k of Object.keys(a.daily)) if (k < dayKey(new Date(Date.now() - 30 * 86400000))) delete a.daily[k];
    d.arcade[run.id] = a;
    d.shells += shells;
  });
  isBest || score > prevBest ? sfx.win() : sfx.lose();
  announceAchievements();
  const board = run.daily ? run.id + 'Daily' : run.id;
  const p = modal(`<h2>${g.icon} ${run.sim.overReason || 'Game over!'}</h2>
    <div class="big-score">${fmt(score)}</div>
    ${isBest ? '<p>🎉 New personal best!</p>' : `<p class="muted">Best: ${fmt(prev.best)}</p>`}
    ${run.daily ? `<p class="small muted">Daily challenge · ${score > prevBest && prevBest ? 'improved your best today!' : prevBest ? `today's best ${fmt(Math.max(prevBest, score))}` : 'first try today'}</p>` : ''}
    <div class="reward">+${shells} 🐚${hot ? ' (🔥 2×)' : ''}</div>
    <p class="muted small" id="r-rank">Checking leaderboard…</p>`, {
    dismissable: false,
    buttons: [
      { label: '↻ Play again', value: 'again', cls: 'green' },
      ...(run.daily ? [{ label: '📤 Share', value: 'share', cls: 'blue' }] : []),
      { label: '🏆 Leaderboard', value: 'lb', cls: 'ghost' },
      { label: '🕹️ Arcade', value: 'hub', cls: 'ghost' },
    ],
  });
  let rank = null;
  submitRun({ board, key: run.daily ? run.key : 'all', seed: run.seed, log: run.sim.log, score }).then((res) => {
    rank = res?.rank;
    if (res?.rank && run.daily) update((d) => { d.lastRanks = { ...(d.lastRanks || {}), [`${board}:${run.key}`]: res.rank }; });
    const el = $('#r-rank');
    if (!el) return;
    if (res?.queued) el.textContent = "Offline – we'll submit your score later.";
    else if (res?.skipped) el.textContent = 'Leaderboard is turned off in settings.';
    else if (res?.rank) el.innerHTML = `${run.daily ? "Today's" : 'All-time'} rank: <b>#${res.rank}</b>${res.rank > 1 ? ' – one more try?' : ' 👑'}`;
    else el.textContent = res?.error || '';
  });
  const r = await p;
  if (r === 'again') playArcade(run.id, { daily: run.daily });
  else if (r === 'share') { await shareText(`${g.icon} Tidepop ${g.title} daily ${run.key}\nScore: ${fmt(score)}${rank ? ` · Rank #${rank}` : ''}\nBeat me: ${location.origin}${location.pathname}`); showHub(); }
  else if (r === 'lb') showLeaderboard(board);
  else showHub();
}

// ------------------------------------------------------------------ Reef Blocks
async function blocksMenu() {
  const s = load();
  const key = dayKey();
  const r = await modal(`<h2>🧱 Reef Blocks</h2>
    <p>Drag pieces onto the reef. Fill a <b>row or column</b> to clear it. Clear several at once or keep clearing turn after turn for <b>combos</b>!</p>
    <p class="muted small">Best: <b>${fmt(s.blocks.best)}</b> · Today's daily: <b>${s.blocksDaily[key] !== undefined ? fmt(s.blocksDaily[key]) : '–'}</b></p>`, {
    buttons: [
      ...(s.blocksRun ? [{ label: '▶ Continue run', value: 'continue', cls: 'green' }] : []),
      { label: s.blocksRun ? 'New endless run' : '▶ Endless', value: 'endless', cls: s.blocksRun ? 'blue' : 'green' },
      { label: '📅 Daily Reef (same pieces for all)', value: 'daily', cls: 'blue' },
      { label: '🏆 Leaderboard', value: 'lb', cls: 'ghost' },
    ],
  });
  if (r === 'continue') playBlocks({ resume: true });
  else if (r === 'endless') { update((d) => { d.blocksRun = null; }); playBlocks({}); }
  else if (r === 'daily') playBlocks({ daily: true });
  else if (r === 'lb') showLeaderboard('blocks');
}

function playBlocks(opts) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  setBackground(['#4be3c0', '#0b6e8a']);
  const s = load();
  const key = dayKey();
  let seed, game;
  if (opts.resume && s.blocksRun) {
    seed = s.blocksRun.seed;
    const r = replayBlocks(seed, s.blocksRun.log);
    game = r.ok ? r.game : new BlockGame({ seed });
  } else {
    seed = opts.daily ? blocksSeed('blocksDaily', key) : randSeed();
    game = new BlockGame({ seed });
  }
  const run = { kind: 'blocks', daily: !!opts.daily, seed, key, game };
  currentRun = run;
  const best = () => (run.daily ? load().blocksDaily[key] || 0 : load().blocks.best);
  const el = showScreen('blocks', `
    <div class="hud">
      <button class="icon-btn" id="b-pause" aria-label="Pause">⏸</button>
      <div class="box grow"><span class="lbl">Score</span><span class="n" id="b-score" style="font-size:1.6rem;font-weight:900">0</span></div>
      <div class="box"><span class="lbl">${run.daily ? 'Today best' : 'Best'}</span><b id="b-best">${fmt(best())}</b></div>
    </div>
    <div class="board-wrap"><canvas id="b-canvas" aria-label="Reef Blocks board. Press 1, 2 or 3 to pick a piece, arrows to move, Enter to place."></canvas></div>
    <div class="boosters">
      <button class="booster" id="b-undo" aria-label="Undo last move">↶<span class="cnt">${game.undosLeft}</span></button>
      <div class="mode-label" style="align-self:center">${run.daily ? '📅 Daily Reef' : '🧱 Endless'} · combo <b id="b-combo">–</b></div>
    </div>`);
  const refresh = () => {
    $('#b-score', el).textContent = fmt(game.score);
    $('#b-best', el).textContent = fmt(Math.max(best(), game.score));
    $('#b-combo', el).textContent = game.combo > 1 ? `x${game.combo}` : '–';
    $('#b-undo .cnt', el).textContent = game.undosLeft;
    $('#b-undo', el).disabled = !(game.undosLeft > 0 && game.prev);
  };
  view = new BlocksView($('#b-canvas', el), game, {
    reducedMotion: s.settings.reducedMotion,
    onPlaced: (res) => {
      refresh();
      if (!run.daily) update((d) => { d.blocksRun = game.state === 'playing' ? { seed, log: game.log } : null; });
      if (res.perfect) update((d) => { d.stats.perfectClears++; });
      if (game.state === 'over') setTimeout(() => endBlocks(run), 600);
    },
  });
  $('#b-pause', el).onclick = () => { sfx.tap(); pauseMenu(); };
  $('#b-undo', el).onclick = () => {
    if (game.undo()) { sfx.swap(); refresh(); if (!run.daily) update((d) => { d.blocksRun = { seed, log: game.log }; }); }
  };
  refresh();
  if (!load().blocks.games && !opts.resume) toast('Drag a piece from the tray onto the reef!');
}

async function endBlocks(run) {
  if (run.ended) return;
  run.ended = true;
  const game = run.game;
  const score = game.score;
  const s = load();
  const prevBest = run.daily ? s.blocksDaily[run.key] || 0 : s.blocks.best;
  const isBest = score > prevBest;
  const hotBonus = noteGameEnd('reef', isBest) ? 2 : 1;
  const shells = Math.min(40, 3 + Math.floor(score / 100)) * hotBonus;
  update((d) => {
    d.blocks.games++;
    if (score > d.blocks.best) d.blocks.best = score;
    if (run.daily) d.blocksDaily[run.key] = Math.max(d.blocksDaily[run.key] || 0, score);
    d.blocksRun = null;
    d.stats.lines += game.linesCleared;
    d.stats.bestCombo = Math.max(d.stats.bestCombo, game.bestCombo);
    d.shells += shells;
  });
  isBest ? sfx.win() : sfx.lose();
  announceAchievements();
  const board = run.daily ? 'blocksDaily' : 'blocks';
  const p = modal(`<h2>No more room!</h2>
    <div class="big-score">${fmt(score)}</div>
    ${isBest ? '<p>🎉 New best!</p>' : `<p class="muted">Best: ${fmt(prevBest)}</p>`}
    <p class="muted small">${game.linesCleared} lines · best combo x${game.bestCombo || 0} · ${game.placed} pieces</p>
    <div class="reward">+${shells} 🐚</div>
    <p class="muted small" id="r-rank">Checking leaderboard…</p>`, {
    dismissable: false,
    buttons: [
      { label: '↻ Play again', value: 'again', cls: 'green' },
      ...(run.daily ? [{ label: '📤 Share', value: 'share', cls: 'blue' }] : []),
      { label: '🏆 Leaderboard', value: 'lb', cls: 'ghost' },
      { label: '🏠 Home', value: 'home', cls: 'ghost' },
    ],
  });
  let rank = null;
  submitRun({ board, key: run.daily ? run.key : 'all', seed: run.seed, log: game.log, score }).then((res) => {
    rank = res?.rank;
    const el = $('#r-rank');
    if (!el) return;
    if (res?.queued) el.textContent = "Offline – we'll submit your score later.";
    else if (res?.skipped) el.textContent = 'Leaderboard is turned off in settings.';
    else if (res?.rank) el.innerHTML = `World rank: <b>#${res.rank}</b>`;
    else el.textContent = res?.error || '';
  });
  const r = await p;
  if (r === 'again') playBlocks({ daily: run.daily });
  else if (r === 'share') { await shareText(`🧱 Tidepop Daily Reef ${run.key}\nScore: ${fmt(score)}${rank ? ` · Rank #${rank}` : ''}\n${location.origin}${location.pathname}`); showHub(); }
  else if (r === 'lb') showLeaderboard(board);
  else showHub();
}

// ------------------------------------------------------------------ leaderboards
const LB_GAMES = () => [
  { id: 'tidepop', label: '🐚 Tidepop', boards: [['daily', '📅 Daily Dive'], ['deep', '🐋 Deep Dive'], ['stars', '⭐ Adventure']] },
  { id: 'reef', label: '🧱 Reef Blocks', boards: [['blocksDaily', '📅 Today'], ['blocks', '🏆 All-time']] },
  ...ARCADE.map((g) => ({ id: g.id, label: `${g.icon} ${g.title}`, boards: [[g.id + 'Daily', '📅 Today'], [g.id, '🏆 All-time']] })),
];
const boardKey = (board) => (BOARDS[board].period === 'day' ? dayKey() : BOARDS[board].period === 'week' ? weekKey() : 'all');

function localBest(board) {
  const s = load();
  const def = BOARDS[board];
  if (def?.arcade) {
    const st = arcadeStats(def.arcade);
    return def.daily ? st.daily[dayKey()] : st.best || undefined;
  }
  switch (board) {
    case 'daily': return s.dailyDive[dayKey()]?.best;
    case 'deep': return s.deep[weekKey()];
    case 'blocksDaily': return s.blocksDaily[dayKey()];
    case 'blocks': return s.blocks.best || undefined;
    case 'stars': return totalStars(s) || undefined;
  }
}

async function showLeaderboard(board = 'daily') {
  leaveGame();
  setBackground(['#7c4dff', '#1a237e']);
  const s = load();
  if (!BOARDS[board]) board = 'daily';
  const games = LB_GAMES();
  const game = games.find((g) => g.boards.some(([b]) => b === board)) || games[0];
  const tab = { board, key: () => boardKey(board) };
  const el = showScreen('leaderboard', `
    <div class="topbar"><button class="icon-btn" id="l-back" aria-label="Back">←</button><h2 class="grow">Leaderboards</h2>
      <button class="icon-btn" id="l-refresh" aria-label="Refresh">⟳</button></div>
    <div class="tabs" role="tablist" aria-label="Game">${games.map((g) => `<button role="tab" class="tab ${g.id === game.id ? 'on' : ''}" data-b="${g.boards[0][0]}" aria-selected="${g.id === game.id}">${g.label}</button>`).join('')}</div>
    <div class="tabs sub" role="tablist" aria-label="Board">${game.boards.map(([b, label]) => `<button role="tab" class="tab ${b === board ? 'on' : ''}" data-b="${b}" aria-selected="${b === board}">${label}</button>`).join('')}</div>
    <p class="small muted" id="l-sub">${BOARDS[tab.board].period === 'day' ? `Today (${tab.key()} UTC)` : BOARDS[tab.board].period === 'week' ? `This week (${tab.key()})` : 'All time'} · every score is verified by replaying the game${api.backendKind() === 'shared' ? '' : ' on the server'}</p>
    <div class="scroll"><div class="list" id="l-list"><p class="center muted">Loading…</p></div></div>
    <p class="center small muted">You are <b>${esc(s.name)}</b> · <button class="btn sm ghost" id="l-name">Change name</button></p>`);
  $('#l-back', el).onclick = () => { sfx.tap(); showHub(); };
  $('#l-refresh', el).onclick = () => { sfx.tap(); showLeaderboard(tab.board); };
  $('#l-name', el).onclick = () => { sfx.tap(); showSettings(); };
  for (const b of $$('.tab', el)) b.onclick = () => { sfx.tap(); showLeaderboard(b.dataset.b); };
  $('.tab.on', el)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const list = $('#l-list', el);
  const unit = tab.board === 'stars' ? '⭐' : '';
  if (!s.settings.leaderboard) {
    list.innerHTML = `<div class="tip">The online leaderboard is turned off in Settings. Your best here: <b>${localBest(tab.board) !== undefined ? fmt(localBest(tab.board)) : '–'}</b></div>`;
    return;
  }
  try {
    await api.flushPending().catch(() => {});
    const data = await api.top(tab.board, tab.key());
    if (currentScreen() !== 'leaderboard') return;
    $('#l-sub', el)?.insertAdjacentHTML('beforeend', api.backendKind() === 'shared' ? ' · shared with everyone who plays this page' : '');
    if (!data.entries.length) {
      list.innerHTML = `<p class="center muted">No scores yet – be the first! 🐚</p>`;
      return;
    }
    list.innerHTML = data.entries.map((e) => `<div class="item ${e.me ? 'me' : ''}"><span class="rank ${e.rank <= 3 ? 'medal-' + e.rank : ''}">${e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : '#' + e.rank}</span><span class="name">${esc(e.name)}${e.me ? ' (you)' : ''}</span><span class="val">${fmt(e.score)} ${unit}</span></div>`).join('')
      + (data.me && !data.entries.some((e) => e.me) ? `<div class="item me"><span class="rank">#${data.me.rank}</span><span class="name">${esc(s.name)} (you)</span><span class="val">${fmt(data.me.score)} ${unit}</span></div>` : '')
      + `<p class="center small muted">${data.total} player${data.total === 1 ? '' : 's'}</p>`;
  } catch (e) {
    if (currentScreen() !== 'leaderboard') return;
    const lb = localBest(tab.board);
    if (e?.status === 403 || e?.status === 401) { list.innerHTML = `<div class="tip">${esc(e.message)} Your best here: <b>${lb !== undefined ? fmt(lb) : '–'}</b></div>`; return; }
    list.innerHTML = `<div class="tip">📡 Can't reach the leaderboard server right now (offline, or no server is set up for this copy of the game).<br><br>Your best here: <b>${lb !== undefined ? fmt(lb) + ' ' + unit : '–'}</b>${s.pending.length ? `<br>${s.pending.length} score(s) waiting to be sent.` : ''}</div>`;
  }
}

// ------------------------------------------------------------------ achievements / shop / help
function showAchievements() {
  leaveGame();
  const s = load();
  const el = showScreen('achievements', `
    <div class="topbar"><button class="icon-btn" id="a-back" aria-label="Back">←</button><h2 class="grow">Achievements</h2>
      <span class="pill">${Object.keys(s.achievements).length}/${ACHIEVEMENTS.length}</span></div>
    <div class="scroll ach"><div class="list">${ACHIEVEMENTS.map((a) => {
    const got = !!s.achievements[a.id];
    const v = Math.min(a.goal, a.get(s) || 0);
    return `<div class="item ${got ? '' : 'locked'}"><span style="font-size:1.6rem">${got ? a.icon : '🔒'}</span>
      <div class="grow" style="text-align:left"><b>${esc(a.name)}</b><div class="small muted">${esc(a.desc)}</div>
      ${got ? '' : `<div class="progress"><div style="width:${(v / a.goal) * 100}%"></div></div>`}</div>
      <span class="val">${got ? '✅' : `+${a.reward}🐚`}</span></div>`;
  }).join('')}</div></div>`);
  $('#a-back', el).onclick = () => { sfx.tap(); showHub(); };
}

async function showShop() {
  const s = load();
  const r = await modal(`<h2>🛍️ Shell Shop</h2><p class="muted small">Shells are earned by playing – win levels, finish dives, claim daily treasure and unlock achievements. There's nothing to buy with real money, ever.</p>
    <p><span class="pill">🐚 ${fmt(s.shells)}</span></p>
    <div class="list">${SHOP.map((it) => `<div class="item"><span style="font-size:1.6rem">${it.icon}</span><div class="grow" style="text-align:left"><b>${it.name}</b> <span class="small muted">(have ${s.boosters[it.id]})</span><div class="small muted">${it.desc}</div></div>
      <button class="btn sm" data-buy="${it.id}" ${s.shells < it.price ? 'disabled' : ''}>🐚 ${it.price}</button></div>`).join('')}</div>`,
  {
    buttons: [{ label: 'Done', value: null, cls: 'ghost' }],
    onOpen: (sheet) => {
      for (const b of $$('[data-buy]', sheet)) {
        b.onclick = () => {
          const it = SHOP.find((x) => x.id === b.dataset.buy);
          if (load().shells < it.price) return;
          update((d) => { d.shells -= it.price; d.boosters[it.id]++; });
          sfx.coin();
          toast(`Bought ${it.icon} ${it.name}`);
          closeModal('again');
        };
      }
    },
  });
  if (r === 'again') showShop();
  else if (currentScreen() === 'home') goHome();
  else if (currentScreen() === 'hub') showHub();
}

function howToPlay() {
  const ic = (c) => `<img alt="" src="${iconURL(c, 48)}" style="width:26px;height:26px;vertical-align:middle">`;
  return modal(`<h2>How to play</h2>
    <div class="tip"><b>Match 3+</b> ${ic(0)}${ic(0)}${ic(0)} by swiping a creature into a neighbour's spot (or tap one, then tap its neighbour). Only swaps that make a match count.</div>
    <div class="tip"><b>Specials</b><br>🌊 <b>Wave</b> – match 4 in a line. Clears a whole row or column.<br>🫧 <b>Bubble Bomb</b> – match in an L or T shape. Blasts the 3×3 area.<br>🦪 <b>Pearl</b> – match 5 in a line. Swap it with any creature to clear every one of that kind.</div>
    <div class="tip"><b>Combos</b> – swap two specials together! Wave+Wave = cross, Wave+Bomb = giant cross, Bomb+Bomb = huge blast, Pearl+special = transform them all, Pearl+Pearl = clear the board!</div>
    <div class="tip"><b>Goals</b> – 🎯 reach a score, collect creatures, 🌿 clean algae (match on top of it), 📦 break crates (match next to them). Leftover moves become a <b>Tidal Finale</b> for bonus points.</div>
    <div class="tip"><b>Reef Blocks</b> – drag pieces onto the 8×8 reef. Full rows and columns clear. Keep clearing for combos; one undo per run.</div>
    <div class="tip"><b>Keyboard</b> – arrows move, Enter selects; in Reef Blocks press 1/2/3 to pick a piece.</div>`,
  { buttons: [{ label: 'Got it!', value: true }] });
}

// ------------------------------------------------------------------ settings
function wireSwitches(root) {
  for (const sw of $$('.switch', root)) {
    sw.onclick = () => {
      const k = sw.dataset.k;
      const v = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(v));
      update((d) => { d.settings[k] = v; });
      applySettings();
      if (k === 'reducedMotion') clearSpriteCache();
      sfx.tap();
    };
  }
}

async function shareText(text) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch { return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard!');
  } catch {
    await modal(`<h2>Share</h2><textarea readonly>${esc(text)}</textarea>`, { buttons: [{ label: 'Close', value: null }] });
  }
}

function showSettings() {
  leaveGame();
  const s = load();
  const [adj, animal, num] = s.name.split(' ');
  const sw = (k, label, sub = '') => `<div class="setting"><span>${label}${sub ? `<br><span class="small muted">${sub}</span>` : ''}</span><button class="switch" role="switch" aria-label="${label}" data-k="${k}" aria-checked="${!!s.settings[k]}"></button></div>`;
  const el = showScreen('settings', `
    <div class="topbar"><button class="icon-btn" id="s-back" aria-label="Back">←</button><h2 class="grow">Settings</h2></div>
    <div class="scroll">
      <h3>Your name</h3>
      <p class="small muted">Names are built from friendly words so the leaderboard stays kind and nobody shares personal info.</p>
      <div class="row" style="flex-wrap:wrap">
        <select id="s-adj" aria-label="Adjective">${ADJECTIVES.map((a) => `<option ${a === adj ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <select id="s-animal" aria-label="Animal">${ANIMALS.map((a) => `<option ${a === animal ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <select id="s-num" aria-label="Number">${Array.from({ length: 90 }, (_, i) => i + 10).map((x) => `<option ${String(x) === num ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <button class="btn sm" id="s-save-name">Save</button>
      </div>
      <h3 style="margin-top:18px">Sound & feel</h3>
      ${sw('sfx', '🔊 Sound effects')}${sw('music', '🎵 Music')}${sw('haptics', '📳 Vibration')}
      ${sw('reducedMotion', '🧘 Reduced motion', 'Calmer animations, no screen shake')}
      <h3 style="margin-top:18px">Leaderboards</h3>
      ${sw('leaderboard', '🏆 Take part in online leaderboards', 'Only your nickname and scores are shared')}
      <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:10px">
        <button class="btn sm ghost" id="s-forget">Delete my online scores</button>
      </div>
      <h3 style="margin-top:18px">Your progress</h3>
      <p class="small muted">Progress is saved on this device. Move it to another device with a save code.</p>
      <div class="row" style="flex-wrap:wrap;gap:10px">
        <button class="btn sm blue" id="s-export">Export save code</button>
        <button class="btn sm blue" id="s-import">Import save code</button>
        <button class="btn sm red" id="s-reset">Reset progress</button>
      </div>
      <h3 style="margin-top:18px">About</h3>
      <div class="row" style="flex-wrap:wrap;gap:10px"><button class="btn sm ghost" id="s-help">❓ How to play</button><button class="btn sm ghost" id="s-privacy">🔒 Privacy</button></div>
      <p class="small muted">Tidepop v1.0 (engine ${ENGINE_VERSION}) · free, open & ad-free · no tracking.</p>
    </div>`);
  wireSwitches(el);
  $('#s-back', el).onclick = () => { sfx.tap(); showHub(); };
  $('#s-help', el).onclick = () => howToPlay();
  $('#s-save-name', el).onclick = async () => {
    const name = `${$('#s-adj', el).value} ${$('#s-animal', el).value} ${$('#s-num', el).value}`;
    update((d) => { d.name = name; });
    sfx.coin();
    toast(`You are now ${name}`);
    if (load().token || api.backendKind() === 'shared') api.rename(name).catch(() => toast('Name saved – it will sync to the leaderboard later'));
  };
  $('#s-forget', el).onclick = async () => {
    const ok = await modal('<h2>Delete online scores?</h2><p>This removes your name and all your scores from the online leaderboards. Your progress on this device stays.</p>',
      { buttons: [{ label: 'Delete', value: true, cls: 'red' }, { label: 'Cancel', value: false, cls: 'ghost' }], row: true });
    if (!ok) return;
    try { await api.forgetMe(); toast('Your online scores were deleted'); } catch { toast("Couldn't reach the server – try again when online"); }
  };
  $('#s-export', el).onclick = () => {
    const code = exportSave();
    modal(`<h2>Your save code</h2><p class="small muted">Keep it private – it contains your leaderboard key.</p><textarea readonly id="s-code">${code}</textarea>`,
      { buttons: [{ label: 'Copy', value: 'copy', cls: 'blue' }, { label: 'Close', value: null, cls: 'ghost' }], row: true })
      .then((r) => { if (r === 'copy') navigator.clipboard?.writeText(code).then(() => toast('Copied!'), () => toast('Select the text and copy it')); });
  };
  $('#s-import', el).onclick = async () => {
    let code = '';
    const r = await modal('<h2>Import save</h2><p class="small muted">This replaces the progress on this device.</p><textarea id="s-in" placeholder="Paste your save code"></textarea>',
      { buttons: [{ label: 'Import', value: 'go', cls: 'green' }, { label: 'Cancel', value: null, cls: 'ghost' }], row: true, onOpen: (sh) => { $('#s-in', sh).oninput = (e) => (code = e.target.value); } });
    if (r !== 'go') return;
    try { importSave(code); applySettings(); toast('Progress imported!'); showSettings(); } catch (e) { toast(e.message || 'That code didn’t work'); }
  };
  $('#s-reset', el).onclick = async () => {
    const a = await modal('<h2>Reset all progress?</h2><p>Levels, stars, shells, boosters and achievements on this device will be erased.</p>',
      { buttons: [{ label: 'Yes, reset', value: true, cls: 'red' }, { label: 'Cancel', value: false, cls: 'ghost' }], row: true });
    if (!a) return;
    const b = await modal('<h2>Are you really sure?</h2><p>This can’t be undone.</p>',
      { buttons: [{ label: 'Erase everything', value: true, cls: 'red' }, { label: 'Keep my progress', value: false, cls: 'green' }] });
    if (!b) return;
    resetSave();
    applySettings();
    toast('Progress reset. Welcome back to the reef!');
    goHome();
    onboarding();
  };
  $('#s-privacy', el).onclick = () => modal(`<h2>🔒 Privacy</h2><div class="tip">
    • No accounts, emails, ads, trackers or analytics.<br>
    • Your progress stays on your device.<br>
    • If online leaderboards are on, only your word-list nickname, a random player ID and your game moves/scores are sent – to verify scores fairly.<br>
    • Daily boards are deleted after 30 days, weekly boards after 12 weeks.<br>
    • You can delete your online scores at any time in Settings.</div>`, { buttons: [{ label: 'OK', value: null }] });
}

// keep the game safe from accidental pinch-zoom on iOS
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// handy for debugging from the console
window.tidepop = { load, save, getLevel, SPECIAL, view: () => view };

boot();

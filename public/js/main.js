// Tidepop – app controller: screens, flows, progression, leaderboards.

import { Game, replay, SPECIAL } from './engine.js';
import { BlockGame, replayBlocks } from './blocks.js';
import { getLevel, LEVEL_COUNT, MAX_LEVEL, worldOf } from './levels.js';
import { dailyConfig, deepConfig, dayKey, weekKey, blocksSeed, ENGINE_VERSION, BOARDS } from './modes.js';
import { ARCADE, ARCADE_BY_ID, arcadeSeed, tierOf, challengeHash, parseChallenge } from './arcade/index.js';
import { hashString } from './rng.js';
import { ChessVersus, ChessCasual, LudoVersus, TIME_CONTROLS, newCode, validCode, rebuild, describe } from './versus.js';
import { CASUAL_LEVELS } from './arcade/chess.js';
import { tableBackgroundCSS } from './arcade/table.js';
import { TEMPLATES, RULE_INFO, EMOJI, PALETTES, sanitize as ugcSanitize, starterSpec, createSim as ugcCreate } from './maker/engine.js';
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
    // only reload when an UPDATE takes over – not when the very first install claims the page
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
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
  const ch = parseChallenge(location.hash);
  if (!s.onboarded) await onboarding();
  else if (!ch) await maybeDailyReward();
  if (ch) acceptChallenge(ch);
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
  if (currentRun?.kind === 'versus') return versusPause(currentRun);
  const s = load();
  const run = currentRun;
  const r = await modal(`<h2>Paused</h2>
    <div class="setting"><span>🔊 Sound effects</span><button class="switch" role="switch" data-k="sfx" aria-checked="${s.settings.sfx}"></button></div>
    <div class="setting"><span>🎵 Music</span><button class="switch" role="switch" data-k="music" aria-checked="${s.settings.music}"></button></div>`, {
    buttons: [
      { label: '▶ Resume', value: 'resume', cls: 'green' },
      ...(run?.kind === 'level' || run?.kind === 'deep' || run?.practice || run?.kind === 'blocks' || run?.kind === 'arcade' ? [{ label: '↻ Restart', value: 'restart', cls: 'blue' }] : []),
      ...(run?.kind === 'arcade' && run.id === 'ludo' ? [{ label: '🏳️ Leave table (save score)', value: 'leave', cls: 'blue' }] : []),
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
  } else if (r === 'leave') view?.hooks.onQuit?.();
  else if (r === 'help') { if (run?.kind === 'arcade') await arcadeHow(run.id); else await howToPlay(); pauseMenu(); }
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
  breaker: () => import('./arcade/breaker-view.js'),
  catch: () => import('./arcade/catch-view.js'),
  chess: () => import('./arcade/chess-view.js'),
  ludo: () => import('./arcade/ludo-view.js'),
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
      const t = tierOf(g, st.best).tier;
      return { id: g.id, title: g.title, icon: g.icon, tagline: g.tagline, best: `${fmt(st.best)}${t ? ` · ${t.icon}` : ''}`, played: st.daily[dayKey()] !== undefined, dailyBoard: g.id + 'Daily', open: () => arcadeMenu(g.id) };
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
      <div class="hub-timer" role="timer">⏳ Today's challenges end in <b id="u-timer">${hms(msToReset())}</b><br><span class="small">🗓️ Weekly tournament ends in <b>${weekLeft()}</b> · top 10 win shells</span></div>
      <button class="hot-card" id="u-hot"><span class="hot-flame">🔥</span><span class="grow"><small>HOT TODAY · 2× SHELLS</small><b>${hot.icon} ${esc(hot.title)}</b></span><span class="btn sm">Play</span></button>
      <div class="missions">
        <div class="row"><b class="grow">🎯 Daily missions</b><span class="small muted">reward: 🐚 150 + 🎁</span></div>
        ${ms.list.map((m) => `<div class="mission ${m.cur >= m.goal ? 'done' : ''}"><span>${m.cur >= m.goal ? '✅' : '⬜'} ${esc(m.text)}</span><span class="small">${m.cur}/${m.goal}</span></div>`).join('')}
        ${ms.claimed ? '<p class="small muted center">Chest claimed – new missions at reset!</p>' : `<button class="btn wide ${allDone ? 'green' : 'ghost'}" id="u-chest" ${allDone ? '' : 'disabled'}>${allDone ? '🎁 Open the mission chest' : 'Complete all 3 to open the chest'}</button>`}
      </div>
      <div class="community-row">
        <button class="card" id="u-community"><span class="emoji">🌟</span><b>Community games</b><span class="sub">Made by players · play, rate & compete</span></button>
        <button class="card" id="u-studio"><span class="emoji">🛠️</span><b>Creator Studio</b><span class="sub">Build your own game – no coding</span></button>
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
  on('#u-community', () => showCommunity());
  on('#u-studio', () => showStudio());
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
  claimWeeklyPrizes();
}

function weekLeft() {
  const now = new Date();
  const day = now.getUTCDay() || 7; // Monday = 1
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (8 - day));
  const ms = end - now.getTime();
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

const WEEK_PRIZES = [300, 200, 150, 75, 75, 75, 75, 75, 75, 75];
let weeklyChecked = false;
/** When a new week starts, award shells for last week's top-10 finishes. */
async function claimWeeklyPrizes() {
  if (weeklyChecked || !load().settings.leaderboard) return;
  weeklyChecked = true;
  const lastWeek = weekKey(new Date(Date.now() - 7 * 86400000));
  const s = load();
  if (s.weeklyClaimed === lastWeek) return;
  const played = ARCADE.filter((g) => arcadeStats(g.id).week?.[lastWeek] !== undefined);
  if (!played.length) { update((d) => { d.weeklyClaimed = lastWeek; }); return; }
  const wins = [];
  try {
    for (const g of played) {
      const data = await api.top(g.id + 'Week', lastWeek);
      if (data.me && data.me.rank <= WEEK_PRIZES.length) wins.push({ g, rank: data.me.rank, prize: WEEK_PRIZES[data.me.rank - 1] });
    }
  } catch {
    weeklyChecked = false; // offline – try again later
    return;
  }
  const total = wins.reduce((a, w) => a + w.prize, 0);
  update((d) => { d.weeklyClaimed = lastWeek; d.shells += total; });
  if (wins.length) {
    sfx.win();
    await modal(`<h2>🗓️ Weekly tournament results</h2><p class="muted small">Week ${esc(lastWeek)}</p>
      <div class="list">${wins.map((w) => `<div class="item"><span class="rank">#${w.rank}</span><span class="name">${w.g.icon} ${esc(w.g.title)}</span><span class="val">+${w.prize} 🐚</span></div>`).join('')}</div>
      <p>A new tournament has started – defend your spot!</p>`, { buttons: [{ label: `Collect ${total} 🐚`, value: true, cls: 'green' }] });
    if (currentScreen() === 'hub') showHub();
  }
}

function nameParts(name) {
  const [a, n, num] = String(name).split(' ');
  return [Math.max(0, ADJECTIVES.indexOf(a)), Math.max(0, ANIMALS.indexOf(n)), Number(num) >= 10 && Number(num) <= 99 ? Number(num) : 10];
}
const nameFromParts = ([a, n, num]) => `${ADJECTIVES[a] || 'Mystery'} ${ANIMALS[n] || 'Fish'} ${num}`;

async function acceptChallenge(ch) {
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ }
  const g = ARCADE_BY_ID[ch.game];
  const who = nameFromParts(ch.name);
  const r = await modal(`<h2>⚔️ Challenge!</h2>
    <p><b>${esc(who)}</b> challenges you to beat</p>
    <div class="big-score">${fmt(ch.score)}</div>
    <p>in ${g.icon} <b>${esc(g.title)}</b> – on the exact same run they played.</p>`, {
    buttons: [{ label: '⚔️ Accept', value: 'go', cls: 'green' }, { label: 'Not now', value: null, cls: 'ghost' }], row: true,
  });
  if (r === 'go') playArcade(ch.game, { daily: false, seed: ch.seed, challenge: { score: ch.score, who } });
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
    ${(() => { const t = tierOf(g, st.best); return `<p class="small">${t.tier ? `Rank: <b>${t.tier.icon} ${t.tier.name}</b>` : 'Unranked'}${t.next ? ` · ${t.next.icon} ${t.next.name} at <b>${fmt(t.nextAt)}</b>` : ' · top tier!'}</p>`; })()}
    <div class="tip">📅 The <b>daily challenge</b> is the same for every player today. Best score of the day wins – it ends in <b>${hms(msToReset())}</b>.</div>`, {
    buttons: [
      { label: g.board ? '▶ Play the ladder' : '▶ Play', value: 'play', cls: 'green' },
      ...(id === 'ludo' ? [{ label: '👥 Pass & play · 2–4 players (offline)', value: 'party', cls: 'blue' }, { label: '🤖 Quick game vs computer', value: 'cpu', cls: 'blue' }] : []),
      ...(id === 'chess' ? [{ label: '🤖 Play vs computer', value: 'cpu', cls: 'blue' }] : []),
      ...(g.board ? [{ label: '👥 Play a friend', value: 'friend', cls: 'blue' }] : []),
      { label: `📅 Daily challenge${today === undefined ? ' (new!)' : ''}`, value: 'daily', cls: 'blue' },
      { label: '🏆 Leaderboard', value: 'lb', cls: 'ghost' },
      { label: '❓ How to play', value: 'how', cls: 'ghost' },
    ],
  });
  if (r === 'play') playArcade(id, { daily: false });
  else if (r === 'daily') playArcade(id, { daily: true });
  else if (r === 'lb') showLeaderboard(id + 'Daily');
  else if (r === 'how') { await arcadeHow(id); arcadeMenu(id); }
  else if (r === 'friend') versusMenu(id);
  else if (r === 'cpu') (id === 'chess' ? chessSetup() : ludoVsComputer());
  else if (r === 'party') ludoParty();
}

/** Chess & Ludo are played on a real-looking wooden table instead of the arcade frame. */
function applyTable(el, id) {
  const on = id === 'chess' || id === 'ludo';
  el.classList.toggle('table-mode', on);
  el.classList.toggle('ludo-clean', id === 'ludo');
  el.style.backgroundImage = on ? tableBackgroundCSS() : '';
}

// ------------------------------------------------------------------ play a friend (chess / ludo)
async function versusMenu(id) {
  const g = ARCADE_BY_ID[id];
  const recent = Object.entries(load().versus || {}).filter(([, v]) => v.game === id && Date.now() - v.at < 7 * 86400000);
  const r = await modal(`<h2>${g.icon} Play a friend</h2>
    <p class="muted small">Friendly games aren't ranked – just bragging rights.</p>
    ${recent.length ? `<div class="list">${recent.map(([code, v]) => `<button class="item" data-code="${code}"><span class="grow" style="text-align:left"><b>${code}</b> · ${v.role === 'host' ? 'you created' : 'you joined'}</span><span class="val">Resume ▶</span></button>`).join('')}</div>` : ''}`, {
    buttons: [
      { label: '📱 Same device (pass & play)', value: 'local', cls: 'green' },
      { label: '🌐 Create online match', value: 'create', cls: 'blue' },
      { label: '🔑 Join with a code', value: 'join', cls: 'blue' },
      { label: 'Back', value: 'back', cls: 'ghost' },
    ],
    onOpen: (sheet) => {
      for (const b of $$('[data-code]', sheet)) b.onclick = () => { closeModal('resume:' + b.dataset.code); };
    },
  });
  if (!r || r === 'back') return arcadeMenu(id);
  if (r === 'local') return localVersus(id);
  if (r.startsWith('resume:')) return openOnline(r.slice(7));
  if (!(await api.matches.available())) {
    await modal(`<h2>Online play unavailable</h2><p>${api.inArtifact() ? 'Sign in to Claude to play friends online.' : "Can't reach the game server right now."} You can still play on the same device.</p>`, { buttons: [{ label: 'OK', value: null }] });
    return versusMenu(id);
  }
  if (r === 'create') return createOnline(id);
  if (r === 'join') return joinOnline();
}

const LUDO_COLOURS = [['red', '#e53935', '🔴'], ['green', '#43a047', '🟢'], ['yellow', '#fdd835', '🟡'], ['blue', '#1e88e5', '🔵']];

/** Real-table colour picker. Resolves to a seat 0-3 or null. */
function pickLudoColour(title = 'Pick your colour') {
  const last = load().ludoColour ?? 0;
  return new Promise((resolve) => {
    modal(`<h2>🎲 ${esc(title)}</h2><p class="muted small">Your colour always sits at the bottom-left of the board.</p>
      <div class="colour-pick">${LUDO_COLOURS.map(([n, hex, dot], i) => `<button class="colour-btn ${i === last ? 'on' : ''}" data-c="${i}" style="--c:${hex}" aria-label="${n}"><span>${dot}</span>${n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>`, {
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }],
      onOpen: (sheet) => {
        for (const b of $$('[data-c]', sheet)) b.onclick = () => {
          const c = Number(b.dataset.c);
          update((d) => { d.ludoColour = c; });
          sfx.tap();
          closeModal('c' + c);
        };
      },
    }).then((r) => resolve(r && r.startsWith('c') ? Number(r.slice(1)) : null));
  });
}

/** Seats for "you + N opponents": 1 opponent sits opposite, like a real table. */
function ludoSeats(me, opponents, kind) {
  const order = opponents === 1 ? [(me + 2) % 4] : opponents === 2 ? [(me + 1) % 4, (me + 3) % 4] : [(me + 1) % 4, (me + 2) % 4, (me + 3) % 4];
  return [0, 1, 2, 3].map((i) => (i === me ? 'human' : order.includes(i) ? kind : null));
}

async function ludoVsComputer() {
  const me = await pickLudoColour();
  if (me === null) return arcadeMenu('ludo');
  const n = await modal('<h2>🤖 How many computer players?</h2>', {
    buttons: [{ label: '1 bot (head to head)', value: '1' }, { label: '2 bots', value: '2', cls: 'blue' }, { label: '3 bots (full table)', value: '3', cls: 'blue' }],
  });
  if (!n) return arcadeMenu('ludo');
  return playVersus('ludo', new LudoVersus({ seed: randSeed(), seats: ludoSeats(me, Number(n), 'ai'), mine: [me], first: me }), null);
}

// ---------------------------------------------------------------- chess setup
function pickChessSide(title) {
  return new Promise((resolve) => {
    modal(`<h2>♟️ ${esc(title)}</h2><div class="colour-pick">
      <button class="colour-btn side-w" data-s="w"><span>♔</span>White<small>moves first</small></button>
      <button class="colour-btn side-b" data-s="b"><span>♚</span>Black</button></div>
      <button class="btn sm ghost" data-s="r" style="margin-top:10px">🎲 Random</button>`, {
      buttons: [{ label: 'Cancel', value: null, cls: 'ghost' }],
      onOpen: (sheet) => { for (const b of $$('[data-s]', sheet)) b.onclick = () => { sfx.tap(); closeModal(b.dataset.s); }; },
    }).then((r) => resolve(r === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : r === 'w' || r === 'b' ? r : null));
  });
}

/** Settings sheet: side, bot level, clock, auto-flip. Remembers your last choice. */
function chessOptions({ title, side = true, level = true, flip = false }) {
  const prev = { side: 'w', level: 3, clock: 'none', flip: true, ...(load().chessPrefs || {}) };
  const rec = load().chessRecord || {};
  const seg = (key, items, cur) => `<div class="seg" data-key="${key}">${items.map(([v, l]) => `<button class="seg-btn ${String(v) === String(cur) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  return new Promise((resolve) => {
    let state = { ...prev };
    modal(`<h2>${title}</h2>
      ${side ? `<h3>Your side</h3>${seg('side', [['w', '♔ White'], ['b', '♚ Black'], ['r', '🎲 Random']], prev.side)}` : ''}
      ${level ? `<h3>Opponent</h3>${seg('level', CASUAL_LEVELS.map((L, i) => [i + 1, `${L.name}<small>${L.elo}${rec[i + 1] ? ` · ${rec[i + 1].w}-${rec[i + 1].d}-${rec[i + 1].l}` : ''}</small>`]), prev.level)}` : ''}
      <h3>Time control</h3>${seg('clock', TIME_CONTROLS.map((t) => [t.id, t.label]), prev.clock)}
      ${flip ? `<h3>Board</h3>${seg('flip', [['true', '🔄 Turn board each move'], ['false', 'Keep White at bottom']], prev.flip)}` : ''}`, {
      buttons: [{ label: '▶ Start game', value: 'go', cls: 'green' }, { label: 'Cancel', value: null, cls: 'ghost' }],
      onOpen: (sheet) => {
        for (const group of $$('.seg', sheet)) {
          for (const b of $$('.seg-btn', group)) b.onclick = () => {
            $$('.seg-btn', group).forEach((x) => x.classList.toggle('on', x === b));
            const k = group.dataset.key;
            state[k] = k === 'level' ? Number(b.dataset.v) : k === 'flip' ? b.dataset.v === 'true' : b.dataset.v;
            sfx.tap();
          };
        }
      },
    }).then((r) => {
      if (r !== 'go') return resolve(null);
      update((d) => { d.chessPrefs = state; });
      resolve({ ...state, side: state.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : state.side });
    });
  });
}

async function chessSetup(again) {
  const opts = again || (await chessOptions({ title: '🤖 Play vs computer' }));
  if (!opts) return arcadeMenu('chess');
  playVersus('chess', new ChessCasual({ mySide: opts.side, level: opts.level, clock: opts.clock, name: load().name }), null, { casual: opts });
}

function toPgn(sim) {
  const r = sim.result;
  const res = !r ? '*' : r.winner === 'w' ? '1-0' : r.winner === 'b' ? '0-1' : '1/2-1/2';
  const d = new Date();
  const tags = [['Event', 'Tidepop casual game'], ['Site', 'Tidepop'], ['Date', `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`],
    ['White', sim.names?.w || 'White'], ['Black', sim.names?.b || 'Black'], ['Result', res], ...(r ? [['Termination', r.reason]] : [])];
  const h = sim.game.history;
  let moves = '';
  for (let i = 0; i < h.length; i += 2) moves += `${i / 2 + 1}. ${h[i].san}${h[i + 1] ? ' ' + h[i + 1].san : ''} `;
  return `${tags.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n')}\n\n${moves}${res}`;
}

async function localVersus(id) {
  if (id === 'chess') {
    const opts = await chessOptions({ title: '📱 Pass & play', side: false, level: false, flip: true });
    if (!opts) return versusMenu(id);
    return playVersus(id, new ChessVersus({ clock: opts.clock, autoFlip: opts.flip }), null);
  }
  return ludoParty();
}

// ---------------------------------------------------------------- ludo pass & play (offline, 2-4 players)
const PARTY_PRESETS = {
  2: ['human', null, 'human', null],
  3: ['human', 'human', 'human', null],
  4: ['human', 'human', 'human', 'human'],
};

/** One phone on the table, 2-4 people (plus optional bots). Works fully offline. */
async function ludoParty(again) {
  const saved = load().ludoParty || {};
  let seats = again?.seats || saved.seats || PARTY_PRESETS[2].slice();
  const names = [0, 1, 2, 3].map((i) => (again?.names || saved.names || [])[i] || '');
  let bots = again?.bots ?? saved.bots ?? false;
  const playersOf = (ss) => ss.filter((x) => x === 'human').length;
  const conf = again || await new Promise((resolve) => {
    const rowHtml = (i) => {
      const [n, hex, dot] = LUDO_COLOURS[i];
      const cap = n[0].toUpperCase() + n.slice(1);
      return `<div class="party-row" data-i="${i}" style="--c:${hex}">
        <span class="party-dot">${dot}</span>
        <input class="party-name" maxlength="14" placeholder="${cap}" value="${esc(names[i])}" aria-label="${cap} player name" ${seats[i] === 'human' ? '' : 'disabled'}>
        <div class="seg party-seat">${[['human', '🙂 Player'], ['ai', '🤖 Bot'], ['', '— Empty']].map(([v, l]) => `<button class="seg-btn ${String(seats[i] || '') === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      </div>`;
    };
    modal(`<h2>👥 Pass & play</h2>
      <p class="muted small">One phone, passed around the table – no internet needed. Each player taps the dice on their turn.</p>
      <h3>How many players?</h3>
      <div class="seg party-count">${[2, 3, 4].map((n) => `<button class="seg-btn ${playersOf(seats) === n ? 'on' : ''}" data-n="${n}">${n} players</button>`).join('')}</div>
      <div class="party-rows">${[0, 1, 2, 3].map(rowHtml).join('')}</div>
      <p class="small muted party-hint"></p>`, {
      buttons: [{ label: '▶ Start game', value: 'go', cls: 'green' }, { label: 'Back', value: null, cls: 'ghost' }],
      onOpen: (sheet) => {
        const sync = () => {
          for (const row of $$('.party-row', sheet)) {
            const i = Number(row.dataset.i);
            $$('.seg-btn', row).forEach((b) => b.classList.toggle('on', b.dataset.v === String(seats[i] || '')));
            const inp = $('.party-name', row);
            inp.disabled = seats[i] !== 'human';
            row.classList.toggle('off', !seats[i]);
          }
          const p = playersOf(seats);
          $$('.party-count .seg-btn', sheet).forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === p));
          const total = seats.filter(Boolean).length;
          const hint = $('.party-hint', sheet);
          hint.textContent = p < 1 ? 'Add at least one player.' : total < 2 ? 'A game needs at least 2 seats.' : `${p} player${p === 1 ? '' : 's'}${total > p ? ` + ${total - p} bot${total - p === 1 ? '' : 's'}` : ''} · the first player sits bottom-left`;
          const go = $$('.modal.open .btn', document).find((b) => /Start game/.test(b.textContent));
          if (go) go.disabled = p < 1 || total < 2;
        };
        for (const b of $$('.party-count .seg-btn', sheet)) b.onclick = () => {
          seats = PARTY_PRESETS[Number(b.dataset.n)].slice();
          if (bots) seats = seats.map((x) => x || 'ai');
          sfx.tap(); sync();
        };
        for (const row of $$('.party-row', sheet)) {
          const i = Number(row.dataset.i);
          for (const b of $$('.seg-btn', row)) b.onclick = () => { seats[i] = b.dataset.v || null; bots = seats.includes('ai'); sfx.tap(); sync(); };
          $('.party-name', row).oninput = (e) => { names[i] = e.target.value.trim(); };
        }
        sync();
      },
    }).then((r) => resolve(r === 'go' ? { seats: seats.slice(), names: names.slice(), bots } : null));
  });
  if (!conf || playersOf(conf.seats) < 1 || conf.seats.filter(Boolean).length < 2) return arcadeMenu('ludo');
  update((d) => { d.ludoParty = conf; });
  const nm = {};
  conf.seats.forEach((x, i) => { if (x === 'human' && conf.names[i]) nm[i] = conf.names[i]; });
  const first = conf.seats.findIndex((x) => x === 'human');
  return playVersus('ludo', new LudoVersus({ seed: randSeed(), seats: conf.seats, names: nm, first }), null, { party: conf });
}

async function createOnline(id) {
  let opts;
  if (id === 'chess') {
    const side = await modal('<h2>♟️ Pick your colour</h2>', { buttons: [{ label: '♔ White (moves first)', value: 'w' }, { label: '♚ Black', value: 'b', cls: 'blue' }, { label: '🎲 Random', value: 'r', cls: 'ghost' }] });
    if (!side) return versusMenu(id);
    opts = { hostSide: side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side };
  } else {
    const me = await pickLudoColour();
    if (me === null) return versusMenu(id);
    const b = await modal(`<h2>🎲 Online Ludo</h2><p>You are <b>${LUDO_COLOURS[me][2]} ${LUDO_COLOURS[me][0]}</b>, your friend sits opposite as <b>${LUDO_COLOURS[(me + 2) % 4][2]} ${LUDO_COLOURS[(me + 2) % 4][0]}</b>. Each of you rolls on your own phone.</p>`, { buttons: [{ label: 'Just the two of us', value: 'n' }, { label: 'Add 2 bots to fill the table', value: 'y', cls: 'blue' }] });
    if (!b) return versusMenu(id);
    opts = { bots: b === 'y', hostColour: me };
  }
  const code = newCode();
  try {
    await api.matches.create(code, id, randSeed(), opts);
  } catch (e) {
    toast(e.message || "Couldn't create the match");
    return versusMenu(id);
  }
  update((d) => { d.versus = { ...(d.versus || {}), [code]: { game: id, role: 'host', at: Date.now() } }; });
  openOnline(code, true);
}

async function joinOnline() {
  let code = '';
  const r = await modal(`<h2>🔑 Join a match</h2><p class="muted small">Ask your friend for their 5-letter code.</p>
    <input id="j-code" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="ABCDE" style="text-align:center;font-size:1.6rem;letter-spacing:6px;width:100%;text-transform:uppercase">`, {
    buttons: [{ label: 'Join', value: 'go', cls: 'green' }, { label: 'Cancel', value: null, cls: 'ghost' }],
    row: true,
    onOpen: (sheet) => { const i = $('#j-code', sheet); i.oninput = () => { code = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); i.value = code; }; setTimeout(() => i.focus(), 50); },
  });
  if (r !== 'go') return showHub();
  if (!validCode(code)) { toast('Codes are 5 letters/numbers, like K7PQX'); return joinOnline(); }
  try {
    const m = await api.matches.join(code);
    update((d) => { d.versus = { ...(d.versus || {}), [code]: { game: m.game, role: 'guest', at: Date.now() } }; });
    openOnline(code);
  } catch (e) {
    toast(e.message || "Couldn't join that match");
    joinOnline();
  }
}

async function openOnline(code, justCreated) {
  let m;
  try { m = await api.matches.get(code); } catch { m = null; }
  if (!m || !m.me) { toast('That match has expired'); update((d) => { if (d.versus) delete d.versus[code]; }); return showHub(); }
  const sim = rebuild(m, m.me);
  playVersus(m.game, sim, { code, role: m.me, match: m, justCreated });
}

function myMovesOf(sim, id, role, match) {
  if (id === 'chess') {
    const side = role === 'host' ? match.opts.hostSide : match.opts.hostSide === 'w' ? 'b' : 'w';
    return sim.moves.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === side);
  }
  const hs = Number.isInteger(match.opts.hostColour) ? match.opts.hostColour : 0;
  const seat = role === 'host' ? hs : (hs + 2) % 4;
  return sim.moves.filter(([x]) => x === seat).map(([, t]) => t);
}

async function playVersus(id, sim, online, extra = {}) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  const g = ARCADE_BY_ID[id];
  const mod = await VIEWS[id]();
  setBackground(g.color);
  const run = { kind: 'versus', id, sim, online, casual: extra.casual, party: extra.party };
  currentRun = run;
  const el = showScreen('arcade', `
    <div class="hud">
      <button class="icon-btn" id="ar-pause" aria-label="Menu">⏸</button>
      <div class="box grow arcade-hud" id="ar-hud"></div>
    </div>
    <div class="board-wrap"><canvas id="ar-canvas" aria-label="${esc(g.title)} board"></canvas></div>
    <div id="ar-controls" class="arcade-controls"></div>
    <div class="mode-label" id="ar-label"></div>`);
  applyTable(el, id);
  const refresh = () => {
    const box = $('#ar-hud', el);
    if (!box) return;
    let stats;
    if (id === 'chess') {
      const c = sim.game.history.filter((h) => h.captured);
      stats = [
        { label: 'Mode', value: online ? `🌐 ${online.code}` : sim.level ? `🤖 ${CASUAL_LEVELS[sim.level - 1].name}` : '📱 Pass & play', big: true },
        { label: 'Move', value: Math.floor(sim.game.ply / 2) + 1 },
        { label: 'Captures', value: c.length },
      ];
    } else {
      stats = [
        { label: 'Mode', value: online ? `🌐 ${online.code}` : '📱 Pass & play', big: true },
        { label: 'Turn', value: `${LUDO_COLOURS[sim.game.turn][2]} ${esc(sim.labelOf(sim.game.turn))}` },
      ];
    }
    box.innerHTML = stats.map((h) => `<div class="hstat ${h.big ? 'big' : ''}"><span class="lbl">${esc(String(h.label))}</span><b>${h.value}</b></div>`).join('');
    const lbl = $('#ar-label', el);
    if (lbl) lbl.innerHTML = online ? (online.match.joined || online.joinedNow ? `Playing ${esc(online.role === 'host' ? online.match.guestName || 'your friend' : online.match.hostName || 'your friend')} · moves sync automatically` : `Waiting for a friend to join with code <b>${online.code}</b>`) : sim.level ? `Casual game vs ${esc(CASUAL_LEVELS[sim.level - 1].name)} (${CASUAL_LEVELS[sim.level - 1].elo})${sim.clock ? '' : ' · no clock'}` : 'Friendly game · not ranked';
  };
  let pushed = online ? myMovesOf(sim, id, online.role, online.match).length : 0;
  let applied = online ? (online.role === 'host' ? online.match.guestMoves : online.match.hostMoves).length : 0;
  const pushMine = () => {
    if (!online) return;
    const mine = myMovesOf(sim, id, online.role, online.match);
    if (mine.length === pushed) return;
    pushed = mine.length;
    api.matches.push(online.code, mine).catch(() => toast('Move not sent yet – check your connection'));
  };
  view = new mod.default({
    canvas: $('#ar-canvas', el),
    controls: $('#ar-controls', el),
    sim,
    reducedMotion: load().settings.reducedMotion,
    hooks: {
      onChange: () => { refresh(); pushMine(); },
      onRound: () => { pushMine(); },
      onOver: () => endVersus(run),
      onDraw: async () => {
        if (sim.offerDraw) {
          const ok = sim.offerDraw();
          if (ok) { toast('🤝 The bot accepts a draw'); endVersus(run); }
          else toast(sim.moves.length < 20 ? 'The bot wants to play on – too early for a draw' : 'The bot declines – it thinks it is better');
          return;
        }
        if (sim.local) {
          const asker = sim.names[sim.game.turn], other = sim.names[sim.game.turn === 'w' ? 'b' : 'w'];
          const r = await modal(`<h2>½ Draw offer</h2><p><b>${esc(asker)}</b> offers a draw. <b>${esc(other)}</b>, do you accept?</p>`, { buttons: [{ label: 'Accept draw', value: true, cls: 'green' }, { label: 'Play on', value: false, cls: 'ghost' }], row: true });
          if (r) { sim.agreeDraw(); endVersus(run); }
        }
      },
      onQuit: async () => {
        const chessy = id === 'chess';
        const ok = await modal(`<h2>${online || chessy ? 'Resign this game?' : 'End this game?'}</h2>${chessy ? `<p class="muted">${sim.local ? `${esc(sim.names[sim.game.turn])} resigns – the other side wins.` : 'Your opponent wins the game.'}</p>` : ''}`, { buttons: [{ label: online || chessy ? '🏳️ Resign' : 'End game', value: true, cls: 'red' }, { label: 'Keep playing', value: false, cls: 'ghost' }], row: true });
        if (!ok) return;
        if (online) api.matches.resign(online.code).catch(() => {});
        sim.resign();
        endVersus(run);
      },
    },
  });
  if (id === 'chess' && sim.game.history.length) {
    const h = sim.game.history[sim.game.history.length - 1];
    view.lastMove = [h.uci.slice(0, 2), h.uci.slice(2, 4)].map((x) => 'abcdefgh'.indexOf(x[0]) + (8 - Number(x[1])) * 8);
  }
  $('#ar-pause', el).onclick = () => { sfx.tap(); versusPause(run); };
  refresh();
  if (online) {
    if (online.justCreated) shareCode(online.code, id);
    run.stopWatch = api.matches.watch(online.code, (m) => {
      if (!m || currentRun !== run) return;
      if (m.joined && !online.match.joined) { online.match = m; online.joinedNow = true; toast(`🎉 ${m.me === 'host' ? m.guestName : m.hostName} joined!`); sfx.win(); }
      online.match = m;
      if (id === 'chess') {
        const hs = m.opts.hostSide, gs = hs === 'w' ? 'b' : 'w';
        sim.names = { [hs]: m.hostName || 'Host', [gs]: m.guestName || 'Guest' };
      } else {
        const hs = Number.isInteger(m.opts.hostColour) ? m.opts.hostColour : 0;
        sim.names = { [hs]: online.role === 'host' ? 'You' : m.hostName || 'Host', [(hs + 2) % 4]: online.role === 'guest' ? 'You' : m.guestName || 'Guest' };
      }
      const opp = online.role === 'host' ? m.guestMoves : m.hostMoves;
      while (applied < opp.length && !sim.over) {
        const mv = opp[applied];
        let res;
        if (id === 'chess') {
          if (sim.game.turn === sim.mySide) break;
          res = sim.apply(mv);
          if (res.ok) view.remoteMoved(res.human);
        } else {
          const hs = Number.isInteger(m.opts.hostColour) ? m.opts.hostColour : 0;
          const seat = online.role === 'host' ? (hs + 2) % 4 : hs;
          if (sim.game.turn !== seat) break;
          res = sim.apply(seat, mv);
          if (res.ok) view.remoteEvents(res.events);
        }
        if (!res.ok) break;
        applied++;
        if (res.end && id === 'chess') setTimeout(() => endVersus(run), 900);
      }
      if (m.resigned && !sim.over) {
        const them = m.resigned !== online.role;
        sim.resign(id === 'chess' ? (them ? (sim.mySide === 'w' ? 'b' : 'w') : sim.mySide) : undefined);
        toast(them ? '🏳️ Your friend resigned' : 'You resigned');
        endVersus(run);
      }
      refresh();
      if (id === 'ludo' && sim.over) setTimeout(() => endVersus(run), 1500);
    });
  }
}

function shareCode(code, id) {
  const g = ARCADE_BY_ID[id];
  modal(`<h2>${g.icon} Match created!</h2><p>Send this code to a friend. They open Tidepop → ${esc(g.title)} → Play a friend → Join.</p>
    <div class="big-score" style="letter-spacing:8px">${code}</div>
    <p class="muted small">You can start ${id === 'chess' ? 'if you play White' : 'right away'} – their moves appear here as soon as they play.</p>`, {
    buttons: [{ label: '📤 Share code', value: 'share', cls: 'blue' }, { label: 'Got it', value: null, cls: 'ghost' }], row: true,
  }).then((r) => { if (r === 'share') shareText(`Play ${g.title} with me on Tidepop! Join code: ${code}\n${location.origin}${location.pathname}`); });
}

async function versusPause(run) {
  const r = await modal('<h2>Menu</h2>', { buttons: [{ label: '▶ Resume', value: null, cls: 'green' }, { label: run.online ? '🏳️ Resign' : '🏁 End game', value: 'end', cls: 'ghost' }, { label: run.online ? '🕹️ Back to arcade (match stays open)' : '🕹️ Back to arcade', value: 'hub', cls: 'ghost' }] });
  if (r === 'end') view?.hooks.onQuit?.();
  else if (r === 'hub') { run.stopWatch?.(); showHub(); }
}

async function endVersus(run) {
  if (run.ended) return;
  run.ended = true;
  run.stopWatch?.();
  const { sim, id, online } = run;
  noteGameEnd(id, false);
  if (online) update((d) => { if (d.versus) delete d.versus[online.code]; });
  let html;
  if (id === 'chess') {
    const r = sim.result || { reason: 'Game over' };
    const mine = sim.mySide;
    const won = mine && r.winner === mine;
    const res = !r.winner ? '½–½' : r.winner === 'w' ? '1–0' : '0–1';
    html = `<h2>${r.winner ? (mine ? (won ? '🏆 You win!' : 'You lost') : `${esc(sim.names[r.winner])} wins!`) : '🤝 Draw'}</h2>
      <div class="big-score">${res}</div><p class="muted">${esc(r.reason)} · ${Math.ceil(sim.game.ply / 2)} moves</p>`;
    if (run.casual) {
      const lvl = sim.level;
      update((d) => {
        const rec = { w: 0, d: 0, l: 0, ...((d.chessRecord || {})[lvl] || {}) };
        rec[!r.winner ? 'd' : won ? 'w' : 'l']++;
        d.chessRecord = { ...(d.chessRecord || {}), [lvl]: rec };
        if (won) d.shells += 5 * lvl;
      });
      const rec = load().chessRecord[lvl];
      html += `<p class="small">Your record vs ${esc(CASUAL_LEVELS[lvl - 1].name)}: <b>${rec.w}W · ${rec.d}D · ${rec.l}L</b></p>${won ? `<div class="reward">+${5 * lvl} 🐚</div>` : ''}${won && lvl < 6 ? `<p class="small muted">Ready for ${esc(CASUAL_LEVELS[lvl].name)} (${CASUAL_LEVELS[lvl].elo})?</p>` : ''}`;
    }
    if (mine) won ? sfx.win() : r.winner ? sfx.lose() : sfx.coin();
    const out = await modal(html, {
      dismissable: false,
      buttons: [
        ...(run.casual ? [{ label: '↻ Rematch', value: 'rematch', cls: 'green' }] : []),
        ...(run.casual && won && sim.level < 6 ? [{ label: `⬆️ Next level: ${CASUAL_LEVELS[sim.level].name}`, value: 'up', cls: 'blue' }] : []),
        { label: run.casual ? '⚙️ New game' : '↻ Play again', value: 'again', cls: run.casual ? 'ghost' : 'green' },
        { label: '📋 Copy PGN', value: 'pgn', cls: 'ghost' },
        { label: '🕹️ Arcade', value: 'hub', cls: 'ghost' },
      ],
    });
    if (out === 'pgn') { await shareText(toPgn(sim)); return showHub(); }
    if (out === 'rematch') return chessSetup(run.casual);
    if (out === 'up') return chessSetup({ ...run.casual, level: sim.level + 1 });
    if (out === 'again') return run.casual ? chessSetup() : versusMenu(id);
    return showHub();
  } else {
    const places = sim.places();
    html = `<h2>🎲 Final standings</h2><div class="list">${places.map((p) => `<div class="item"><span class="rank">${['🥇', '🥈', '🥉', '4️⃣'][p.place - 1]}</span><span class="name">${esc(p.name)}</span></div>`).join('')}</div>`;
    sfx.win();
  }
  const r = await modal(html, { dismissable: false, buttons: [
    ...(run.party ? [{ label: '↻ Rematch (same players)', value: 'rematch', cls: 'green' }, { label: '⚙️ Change players', value: 'setup', cls: 'blue' }] : [{ label: '↻ Play again', value: 'again', cls: 'green' }]),
    { label: '🕹️ Arcade', value: 'hub', cls: 'ghost' },
  ] });
  if (r === 'rematch') ludoParty(run.party);
  else if (r === 'setup') ludoParty();
  else if (r === 'again') (sim.mySide !== undefined && !online ? ludoVsComputer() : versusMenu(id));
  else showHub();
}

async function playArcade(id, { daily, seed: forcedSeed, challenge } = {}) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  const g = ARCADE_BY_ID[id];
  const mod = await VIEWS[id]();
  const key = dayKey();
  let colour = null;
  if (id === 'chess') {
    colour = await pickChessSide(daily ? "Today's ladder – choose your side" : 'Ladder – choose your side');
    if (colour === null) return arcadeMenu(id);
  }
  if (id === 'ludo') {
    colour = await pickLudoColour(daily ? "Today's league – pick your colour" : 'League – pick your colour');
    if (colour === null) return arcadeMenu(id);
  }
  const runSeed = forcedSeed !== undefined ? forcedSeed : randSeed();
  const playSeed = forcedSeed !== undefined ? forcedSeed : arcadeSeed(id, daily, key, runSeed);
  const sim = g.create(playSeed);
  if (colour !== null && sim.setColour) sim.setColour(colour);
  const run = { kind: 'arcade', id, daily, key, seed: runSeed, playSeed, sim, challenge };
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
    <div class="mode-label" id="ar-label">${challenge ? `⚔️ Beat <b>${fmt(challenge.score)}</b> by ${esc(challenge.who)}` : daily ? `📅 Daily challenge · ends in ${hms(msToReset())}` : `${g.icon} ${esc(g.title)} · best ${fmt(arcadeStats(id).best)}`}</div>`);
  applyTable(el, id);
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
      onRound: (end) => {
        if (end.winner && end.winner === (sim.mySide || 'w')) toast(`🏆 ${end.reason}! +${fmt(end.gained)} · next: ${sim.opponent}`);
        else if (end.place) toast(end.place <= 2 ? `🎲 ${end.reason}! +${fmt(end.gained)} · next table: smarter bots` : `🎲 ${end.reason} · +${fmt(end.gained)}`);
        else if (!end.winner) toast(`🤝 ${end.reason} · +${fmt(end.gained)} · rematch!`);
      },
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
    else {
      const wk = weekKey();
      a.week = { ...(a.week || {}), [wk]: Math.max(a.week?.[wk] || 0, score) };
      for (const k of Object.keys(a.week)) if (k < weekKey(new Date(Date.now() - 35 * 86400000))) delete a.week[k];
    }
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
    ${run.challenge && score === run.challenge.score ? `<div class="tip">⚔️ <b>It's a tie</b> with ${esc(run.challenge.who)} at ${fmt(score)}! Rematch to settle it.</div>` : ''}
    ${run.challenge && score !== run.challenge.score ? (score > run.challenge.score ? `<div class="tip">⚔️ <b>You beat ${esc(run.challenge.who)}!</b> ${fmt(score)} vs ${fmt(run.challenge.score)} – send it back to them!</div>` : `<div class="tip">⚔️ ${esc(run.challenge.who)} wins this one: ${fmt(run.challenge.score)} vs ${fmt(score)}. Rematch?</div>`) : ''}
    ${(() => { const before = tierOf(g, prev.best).tier, after = tierOf(g, Math.max(prev.best, score)).tier; return after && after !== before ? `<div class="reward">🎖️ Ranked up: ${after.icon} ${after.name}!</div>` : ''; })()}
    <div class="reward">+${shells} 🐚${hot ? ' (🔥 2×)' : ''}</div>
    <p class="muted small" id="r-rank">Checking leaderboard…</p>`, {
    dismissable: false,
    buttons: [
      { label: run.challenge && score <= run.challenge.score ? '⚔️ Rematch (same run)' : '↻ Play again', value: run.challenge && score <= run.challenge.score ? 'rematch' : 'again', cls: 'green' },
      { label: '⚔️ Challenge a friend', value: 'challenge', cls: 'blue' },
      ...(run.daily ? [{ label: '📤 Share', value: 'share', cls: 'ghost' }] : []),
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
    else if (res?.rank) el.innerHTML = `${run.daily ? "Today's" : 'All-time'} rank: <b>#${res.rank}</b>${res.weekRank ? ` · this week: <b>#${res.weekRank}</b>` : ''}${res.rank > 1 ? ' – one more try?' : ' 👑'}`;
    else el.textContent = res?.error || '';
  });
  const r = await p;
  if (r === 'again') playArcade(run.id, { daily: run.daily });
  else if (r === 'rematch') playArcade(run.id, { daily: false, seed: run.playSeed, challenge: run.challenge });
  else if (r === 'challenge') {
    const link = `${location.origin}${location.pathname}#${challengeHash(run.id, run.playSeed, score, nameParts(load().name))}`;
    await shareText(`${g.icon} I scored ${fmt(score)} in ${g.title} on Tidepop. Same run, can you beat me? ${link}`);
    showHub();
  }
  else if (r === 'share') { await shareText(`${g.icon} Tidepop ${g.title} daily ${run.key}\nScore: ${fmt(score)}${rank ? ` · Rank #${rank}` : ''}\nBeat me: ${location.origin}${location.pathname}`); showHub(); }
  else if (r === 'lb') showLeaderboard(board);
  else showHub();
}

// ------------------------------------------------------------------ community games + creator studio
const stars5 = (r) => '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r));
function ugcCard(g) {
  const [c1, c2] = PALETTES[g.palette] || PALETTES[0];
  return `<button class="ugc-card" data-id="${g.id}" style="--c1:${c1};--c2:${c2}">
    <span class="ugc-hero">${g.hero}</span>
    <span class="grow" style="min-width:0;text-align:left"><b class="ugc-title">${esc(g.title)}</b>
      <span class="sub">by ${esc(g.owner)}${g.mine ? ' (you)' : ''} · ${TEMPLATES[g.template]?.icon || ''} ${TEMPLATES[g.template]?.name || ''} · v${g.version}</span>
      <span class="sub"><span class="star-on">${stars5(g.rating)}</span> ${g.ratings ? g.rating.toFixed(1) + ` (${g.ratings})` : 'no ratings yet'} · ▶ ${fmt(g.plays)}</span></span></button>`;
}

async function showCommunity(tab = 'trending') {
  leaveGame();
  setBackground(['#ffb74d', '#4a148c']);
  const el = showScreen('community', `
    <div class="topbar"><button class="icon-btn" id="c-back" aria-label="Back">←</button><h2 class="grow">Community games</h2>
      <button class="icon-btn" id="c-studio" aria-label="Creator Studio">🛠️</button></div>
    <div class="tabs" role="tablist">${[['trending', '🔥 Trending'], ['top', '⭐ Top rated'], ['new', '🆕 New'], ['mine', '🛠️ Mine']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="scroll"><div class="list" id="c-list"><p class="center muted">Loading…</p></div></div>`);
  $('#c-back', el).onclick = () => { sfx.tap(); showHub(); };
  $('#c-studio', el).onclick = () => { sfx.tap(); showStudio(); };
  for (const b of $$('.tab', el)) b.onclick = () => { sfx.tap(); showCommunity(b.dataset.t); };
  const list = $('#c-list', el);
  if (!(await api.ugc.available())) {
    list.innerHTML = `<div class="tip">${api.inArtifact() ? 'Sign in to Claude to browse and play community games.' : "Can't reach the game server right now."}</div>`;
    return;
  }
  let games;
  try { games = await api.ugc.list(); } catch { list.innerHTML = '<div class="tip">📡 Couldn\'t load community games. Try again in a moment.</div>'; return; }
  if (currentScreen() !== 'community') return;
  const bayes = (g) => (g.rating * g.ratings + 3.5 * 3) / (g.ratings + 3);
  const sorted = {
    trending: [...games].sort((a, b) => b.recentPlays * 2 + bayes(b) * 3 - (a.recentPlays * 2 + bayes(a) * 3)),
    top: [...games].filter((g) => g.ratings).sort((a, b) => bayes(b) - bayes(a)),
    new: [...games].sort((a, b) => b.createdAt - a.createdAt),
    mine: games.filter((g) => g.mine),
  }[tab];
  list.innerHTML = sorted.length ? sorted.map(ugcCard).join('') : `<div class="tip">${tab === 'mine' ? "You haven't published a game yet. Open the 🛠️ Creator Studio to make one!" : 'No games here yet – be the first to create one in the 🛠️ Creator Studio!'}</div>`;
  for (const b of $$('.ugc-card', list)) b.onclick = () => { sfx.tap(); ugcDetail(b.dataset.id); };
}

async function ugcDetail(id) {
  let g;
  try { g = await api.ugc.get(id); } catch (e) { toast(e.message || "Couldn't open that game"); return; }
  const key = `${g.id}-${g.version}`;
  const played = (load().ugcPlayed || {})[id];
  const r = await modal(`<div style="font-size:3rem">${g.hero}</div><h2>${esc(g.title)}</h2>
    <p class="muted small">by <b>${esc(g.owner)}</b> · ${TEMPLATES[g.template].icon} ${TEMPLATES[g.template].name} · version ${g.version}</p>
    ${g.description ? `<p>${esc(g.description)}</p>` : ''}
    <p><span class="star-on">${stars5(g.rating)}</span> ${g.ratings ? `${g.rating.toFixed(1)} from ${g.ratings} rating${g.ratings > 1 ? 's' : ''}` : 'Not rated yet'} · ▶ ${fmt(g.plays)} plays</p>
    ${g.mine ? '<p class="small muted">🛠️ You made this – players rate it after they play.</p>' : played ? `<div class="rate-row" role="group" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button class="rate-star ${n <= (g.myRating || 0) ? 'on' : ''}" data-s="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div><p class="small muted">${g.myRating ? 'Your rating – tap to change' : 'Tap to rate this game'}</p>` : '<p class="small muted">Play once to rate it.</p>'}
    <div class="tip"><b>What's new</b><br>${(g.history || []).slice(-3).reverse().map((h) => `v${h.v} · ${new Date(h.at).toLocaleDateString()} – ${esc(h.note)}`).join('<br>')}</div>
    <div class="tip"><b>🏆 Top scores (v${g.version})</b><div id="u-top" class="small">Loading…</div></div>`, {
    buttons: [
      { label: '▶ Play', value: 'play', cls: 'green' },
      ...(g.mine ? [{ label: '✏️ Edit & publish update', value: 'edit', cls: 'blue' }] : []),
      ...(!g.mine ? [{ label: '🚩 Report', value: 'report', cls: 'ghost' }] : []),
      { label: 'Back', value: 'back', cls: 'ghost' },
    ],
    onOpen: (sheet) => {
      for (const b of $$('.rate-star', sheet)) b.onclick = async () => {
        const n = Number(b.dataset.s);
        $$('.rate-star', sheet).forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= n));
        sfx.star(n - 1);
        try { await api.ugc.rate(id, n); toast(`Rated ${n}★ – thanks!`); } catch { toast("Couldn't save your rating"); }
      };
      api.top('ugc', key).then((d) => {
        const t = $('#u-top', sheet);
        if (t) t.innerHTML = d.entries.length ? d.entries.slice(0, 5).map((e) => `${['🥇', '🥈', '🥉', '4.', '5.'][e.rank - 1]} ${esc(e.name)}${e.me ? ' (you)' : ''} – <b>${fmt(e.score)}</b>`).join('<br>') : 'No scores yet – set the first one!';
      }).catch(() => { const t = $('#u-top', sheet); if (t) t.textContent = '–'; });
    },
  });
  if (r === 'play') playUgc(g);
  else if (r === 'edit') editGame(g.spec, g.id, g.version);
  else if (r === 'report') {
    const ok = await modal('<h2>🚩 Report this game?</h2><p>Report games that are mean, scary or inappropriate. Games with several reports are hidden.</p>', { buttons: [{ label: 'Report', value: true, cls: 'red' }, { label: 'Cancel', value: false, cls: 'ghost' }], row: true });
    if (ok) { await api.ugc.report(id).catch(() => {}); toast('Thanks – our community keeps Tidepop kind.'); }
    showCommunity();
  } else if (r === 'back' && currentScreen() !== 'community') showCommunity();
}

async function playUgc(g, { test = false } = {}) {
  leaveGame();
  try { history.pushState({ g: 1 }, ''); } catch { /* sandboxed */ }
  const mod = await import('./maker/view.js');
  const spec = test ? g.spec : g.specs[g.version];
  const seed = randSeed();
  const sim = ugcCreate(spec, seed);
  const run = { kind: 'ugc', g, spec, seed, sim, test };
  currentRun = run;
  setBackground(PALETTES[spec.palette] || PALETTES[0]);
  const el = showScreen('arcade', `
    <div class="hud"><button class="icon-btn" id="ar-pause" aria-label="Pause">⏸</button><div class="box grow arcade-hud" id="ar-hud"></div></div>
    <div class="board-wrap"><canvas id="ar-canvas" aria-label="${esc(spec.title)}"></canvas></div>
    <div id="ar-controls" class="arcade-controls"></div>
    <div class="mode-label">${test ? '🧪 Test play – not ranked' : `${spec.hero} ${esc(spec.title)} · by ${esc(g.owner)}`}</div>`);
  applyTable(el, 'ugc');
  const refresh = () => { const box = $('#ar-hud', el); if (box) box.innerHTML = mod.hud(sim).map((h) => `<div class="hstat ${h.warn ? 'warn' : ''} ${h.big ? 'big' : ''}"><span class="lbl">${esc(h.label)}</span><b>${h.value}</b></div>`).join(''); };
  view = new mod.default({
    canvas: $('#ar-canvas', el), controls: $('#ar-controls', el), sim, reducedMotion: load().settings.reducedMotion,
    hooks: { onChange: refresh, onOver: () => endUgc(run), onQuit: () => { sim.quit(); endUgc(run); } },
  });
  $('#ar-pause', el).onclick = async () => {
    sfx.tap();
    const r = await modal('<h2>Paused</h2>', { buttons: [{ label: '▶ Resume', value: null, cls: 'green' }, { label: '↻ Restart', value: 'restart', cls: 'blue' }, { label: test ? '✏️ Back to editor' : '🌟 Back to community', value: 'quit', cls: 'ghost' }] });
    if (r === 'restart') playUgc(g, { test });
    else if (r === 'quit') { if (test) editGame(g.spec, g.id, g.version, true); else showCommunity(); }
  };
  refresh();
}

async function endUgc(run) {
  if (run.ended) return;
  run.ended = true;
  const { g, sim, test } = run;
  const score = sim.score;
  if (test) {
    const r = await modal(`<h2>🧪 Test run over</h2><div class="big-score">${fmt(score)}</div><p class="muted">${esc(sim.overReason)} · lasted ${Math.round(sim.tick / 60)}s</p>
      <p class="small muted">Tip: a good game lasts 30–120 seconds for a new player. Tweak speed, spawn rate and lives until it feels right.</p>`, { dismissable: false, buttons: [{ label: '↻ Test again', value: 'again', cls: 'green' }, { label: '✏️ Back to editor', value: 'edit', cls: 'blue' }] });
    if (r === 'again') playUgc(g, { test: true });
    else editGame(g.spec, g.id, g.version, true);
    return;
  }
  const best = (load().ugcBest || {})[`${g.id}-${g.version}`] || 0;
  const firstPlay = !(load().ugcPlayed || {})[g.id];
  const shells = Math.min(30, 2 + Math.floor(score / 100));
  update((d) => {
    d.ugcPlayed = { ...(d.ugcPlayed || {}), [g.id]: ((d.ugcPlayed || {})[g.id] || 0) + 1 };
    d.ugcBest = { ...(d.ugcBest || {}), [`${g.id}-${g.version}`]: Math.max(best, score) };
    d.shells += shells;
  });
  noteGameEnd('community', score > best);
  api.ugc.played(g.id).catch(() => {});
  score > best ? sfx.win() : sfx.lose();
  announceAchievements();
  const p = modal(`<h2>${g.hero} ${esc(sim.overReason || 'Game over')}</h2><div class="big-score">${fmt(score)}</div>
    ${score > best ? '<p>🎉 New personal best!</p>' : `<p class="muted">Best: ${fmt(best)}</p>`}
    <div class="reward">+${shells} 🐚</div><p class="muted small" id="r-rank">Checking leaderboard…</p>
    ${firstPlay && !g.mine ? `<div class="tip">How was <b>${esc(g.title)}</b>?<div class="rate-row">${[1, 2, 3, 4, 5].map((n) => `<button class="rate-star" data-s="${n}" aria-label="${n} stars">★</button>`).join('')}</div></div>` : ''}`, {
    dismissable: false,
    buttons: [{ label: '↻ Play again', value: 'again', cls: 'green' }, { label: '🌟 More community games', value: 'more', cls: 'blue' }, { label: '🕹️ Arcade', value: 'hub', cls: 'ghost' }],
    onOpen: (sheet) => {
      for (const b of $$('.rate-star', sheet)) b.onclick = () => {
        const n = Number(b.dataset.s);
        $$('.rate-star', sheet).forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= n));
        sfx.star(n - 1);
        api.ugc.rate(g.id, n).then(() => toast(`Rated ${n}★ – the creator thanks you!`)).catch(() => {});
      };
    },
  });
  api.ugc.submit(g, g.version, run.seed, sim.log).then((res) => {
    const el = $('#r-rank');
    if (el) el.innerHTML = res?.rank ? `Rank on v${g.version}: <b>#${res.rank}</b>${res.rank > 1 ? ' – one more try?' : ' 👑'}` : '';
  }).catch((e) => { const el = $('#r-rank'); if (el) el.textContent = e.status === 401 || api.inArtifact() ? 'Sign in to Claude to post scores.' : ''; });
  const r = await p;
  if (r === 'again') playUgc(g);
  else if (r === 'more') showCommunity();
  else showHub();
}

// ---- studio
function drafts() {
  return load().drafts || {};
}
function saveDraft(id, spec, version) {
  update((d) => { d.drafts = { ...(d.drafts || {}), [id]: { spec, version: version || 0, at: Date.now() } }; });
}

async function showStudio() {
  leaveGame();
  setBackground(['#80cbc4', '#1a237e']);
  const ds = Object.entries(drafts()).sort((a, b) => b[1].at - a[1].at);
  const el = showScreen('studio', `
    <div class="topbar"><button class="icon-btn" id="st-back" aria-label="Back">←</button><h2 class="grow">Creator Studio</h2>
      <button class="icon-btn" id="st-community" aria-label="Community games">🌟</button></div>
    <div class="scroll">
      <p class="muted">Build a game from a template, test it, publish it – then improve it based on what players think. No coding needed!</p>
      <h3>Start a new game</h3>
      <div class="mode-grid">${Object.entries(TEMPLATES).map(([k, t]) => `<button class="card" data-tpl="${k}"><span class="emoji">${t.icon}</span><b>${t.name}</b><span class="sub">${esc(t.blurb)}</span></button>`).join('')}</div>
      ${ds.length ? `<h3 style="margin-top:16px">Drafts on this device</h3><div class="list">${ds.map(([id, d]) => `<button class="item" data-draft="${id}"><span style="font-size:1.6rem">${d.spec.hero}</span><span class="grow" style="text-align:left"><b>${esc(d.spec.title || 'Untitled')}</b><div class="small muted">${TEMPLATES[d.spec.template].name}${d.version ? ` · update to v${d.version}` : ' · not published yet'}</div></span><span class="val">Edit ✏️</span></button>`).join('')}</div>` : ''}
      <h3 style="margin-top:16px">Your published games</h3>
      <div class="list" id="st-mine"><p class="muted small">Loading…</p></div>
    </div>`);
  $('#st-back', el).onclick = () => { sfx.tap(); showHub(); };
  $('#st-community', el).onclick = () => { sfx.tap(); showCommunity(); };
  for (const b of $$('[data-tpl]', el)) b.onclick = () => { sfx.tap(); editGame(starterSpec(b.dataset.tpl), api.newUgcId(), 0); };
  for (const b of $$('[data-draft]', el)) b.onclick = () => { const d = drafts()[b.dataset.draft]; editGame(d.spec, b.dataset.draft, d.version); };
  const mine = $('#st-mine', el);
  if (!(await api.ugc.available())) { mine.innerHTML = `<div class="tip">${api.inArtifact() ? 'Sign in to Claude to publish games.' : "Can't reach the game server – drafts are saved on this device."}</div>`; return; }
  let games = [];
  try { games = (await api.ugc.list()).filter((g) => g.mine); } catch { mine.innerHTML = '<p class="muted small">Couldn\'t load your games.</p>'; return; }
  if (currentScreen() !== 'studio') return;
  const claimed = load().creatorClaimed || {};
  const others = (g) => Math.max(0, g.players - (g.mePlayed ? 1 : 0));
  const owed = games.reduce((sum, g) => sum + Math.max(0, others(g) - (claimed[g.id] || 0)) * 5, 0);
  mine.innerHTML = games.length ? `${owed ? `<button class="btn wide green" id="st-claim">🎁 Collect ${owed} 🐚 creator rewards</button>` : ''}
    ${games.map((g) => `<div class="item"><span style="font-size:1.6rem">${g.hero}</span><span class="grow" style="text-align:left;min-width:0"><b>${esc(g.title)}</b> <span class="small muted">v${g.version}</span>
      <div class="small muted">▶ ${fmt(g.plays)} plays · 👥 ${g.players} players · <span class="star-on">★</span> ${g.ratings ? g.rating.toFixed(1) + ` (${g.ratings})` : '–'}${g.reports ? ` · 🚩 ${g.reports}` : ''}</div></span>
      <button class="btn sm blue" data-edit="${g.id}">✏️</button><button class="btn sm ghost" data-del="${g.id}" aria-label="Unpublish">🗑️</button></div>`).join('')}
    <p class="small muted">You earn 5 🐚 for every new player who tries your games.</p>` : '<p class="muted small">Nothing published yet – pick a template above to start.</p>';
  $('#st-claim', mine) && ($('#st-claim', mine).onclick = () => {
    update((d) => { d.shells += owed; d.creatorClaimed = { ...(d.creatorClaimed || {}), ...Object.fromEntries(games.map((g) => [g.id, others(g)])) }; });
    sfx.coin(); toast(`+${owed} 🐚 – players love your games!`); showStudio();
  });
  for (const b of $$('[data-edit]', mine)) b.onclick = async () => { const g = await api.ugc.get(b.dataset.edit); editGame(g.spec, g.id, g.version); };
  for (const b of $$('[data-del]', mine)) b.onclick = async () => {
    const ok = await modal('<h2>Unpublish this game?</h2><p>It will disappear from the community along with its leaderboards.</p>', { buttons: [{ label: 'Unpublish', value: true, cls: 'red' }, { label: 'Keep it', value: false, cls: 'ghost' }], row: true });
    if (ok) { await api.ugc.remove(b.dataset.del).catch(() => toast("Couldn't unpublish")); showStudio(); }
  };
}

function editGame(spec0, id, version, fromTest) {
  leaveGame();
  const spec = JSON.parse(JSON.stringify(spec0));
  spec.rules = { ...TEMPLATES[spec.template].rules, ...spec.rules };
  const tpl = TEMPLATES[spec.template];
  setBackground(PALETTES[spec.palette] || PALETTES[0]);
  const emojiGrid = (list, field, cur) => `<div class="emoji-grid" data-field="${field}">${list.map((e) => `<button class="emoji-pick ${e === cur ? 'on' : ''}" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`;
  const el = showScreen('editor', `
    <div class="topbar"><button class="icon-btn" id="ed-back" aria-label="Back">←</button><h2 class="grow">${tpl.icon} ${version ? `Update v${version} → v${version + 1}` : `New ${tpl.name} game`}</h2></div>
    <div class="scroll editor">
      <div class="preview-wrap"><canvas id="ed-preview" aria-label="Live preview"></canvas><span class="small muted">Live preview – it replays as you edit</span></div>
      <label>Title<input id="ed-title" maxlength="30" value="${esc(spec.title)}" placeholder="e.g. Starfish Storm"></label>
      <label>Description<textarea id="ed-desc" maxlength="160" placeholder="One line that makes people want to play">${esc(spec.description)}</textarea></label>
      <h3>Hero</h3>${emojiGrid(EMOJI.heroes, 'hero', spec.hero)}
      <h3>Goodies <span class="small muted">(up to 3 – tap to add/remove)</span></h3>
      ${emojiGrid(EMOJI.items, 'good', null)}
      <div id="ed-goods" class="pill-row"></div>
      <h3>Hazards <span class="small muted">(up to 3)</span></h3>
      ${emojiGrid(EMOJI.hazards, 'bad', null)}
      <div id="ed-bads" class="pill-row"></div>
      <h3>Colours</h3>
      <div class="swatches">${PALETTES.map(([a, b], i) => `<button class="swatch ${i === spec.palette ? 'on' : ''}" data-p="${i}" style="background:linear-gradient(${a},${b})" aria-label="Palette ${i + 1}"></button>`).join('')}</div>
      <h3>Rules</h3>
      ${Object.keys(tpl.rules).map((k) => { const ri = RULE_INFO[k]; return `<label class="rule">${ri.label} <b id="rv-${k}">${spec.rules[k]}</b><input type="range" id="r-${k}" min="${ri.min}" max="${ri.max}" step="${ri.step || 1}" value="${spec.rules[k]}"></label>`; }).join('')}
      <div class="row" style="gap:10px;margin:16px 0;flex-wrap:wrap">
        <button class="btn blue grow" id="ed-test">🧪 Test play</button>
        <button class="btn green grow" id="ed-publish">🚀 ${version ? 'Publish update' : 'Publish'}</button>
      </div>
      <p class="small muted">Drafts save automatically on this device. Published games can be updated any time – every version gets its own leaderboard.</p>
    </div>`);
  let previewView = null;
  const restartPreview = async () => {
    previewView?.destroy();
    let clean;
    try { clean = ugcSanitize({ ...spec, title: spec.title.length >= 3 ? spec.title : 'Preview' }); } catch { return; }
    const mod = await import('./maker/view.js');
    if (currentScreen() !== 'editor') return;
    const sim = ugcCreate(clean, 12345);
    if (clean.template === 'flap') sim.flap();
    // a tiny autopilot so the preview shows the game in motion
    const cv = $('#ed-preview', el);
    previewView = new mod.default({ canvas: cv, controls: null, sim, reducedMotion: true, hooks: { onOver: () => setTimeout(restartPreview, 400) } });
    previewView.auto = setInterval(() => {
      if (sim.over) return;
      if (clean.template === 'flap') { const w = sim.objs.find((o) => o.kind === 'wall' && o.x > 18); if (w && sim.hy > w.gy + 4 && sim.vy > 0) sim.flap(); }
      else if (clean.template === 'tap') { const o = sim.objs.find((o) => o.good && sim.tick - o.born > 25); if (o) sim.tap(o.x, o.y); }
      else { const o = sim.objs.filter((o) => o.good).sort((a, b) => b.y - a.y)[0]; if (o) previewView.pointer = [o.x, o.y]; }
    }, 120);
    const destroy = previewView.destroy.bind(previewView);
    previewView.destroy = () => { clearInterval(previewView.auto); destroy(); };
    view = previewView;
  };
  const persist = () => saveDraft(id, spec, version);
  const renderPicks = () => {
    $('#ed-goods', el).innerHTML = spec.good.map((g, i) => `<span class="pill">${g.e} <select data-gi="${i}" aria-label="Points">${[5, 10, 15, 25, 50, 100].map((p) => `<option ${p === g.pts ? 'selected' : ''}>${p}</option>`).join('')}</select> pts <button class="x" data-rg="${i}" aria-label="Remove">✕</button></span>`).join('') || '<span class="small muted">Pick at least one goodie</span>';
    $('#ed-bads', el).innerHTML = spec.bad.map((b, i) => `<span class="pill">${b.e} <button class="x" data-rb="${i}" aria-label="Remove">✕</button></span>`).join('') || '<span class="small muted">Pick at least one hazard</span>';
    for (const s2 of $$('[data-gi]', el)) s2.onchange = () => { spec.good[Number(s2.dataset.gi)].pts = Number(s2.value); persist(); };
    for (const b of $$('[data-rg]', el)) b.onclick = () => { spec.good.splice(Number(b.dataset.rg), 1); renderPicks(); persist(); restartPreview(); };
    for (const b of $$('[data-rb]', el)) b.onclick = () => { spec.bad.splice(Number(b.dataset.rb), 1); renderPicks(); persist(); restartPreview(); };
  };
  renderPicks();
  $('#ed-title', el).oninput = (e) => { spec.title = e.target.value; persist(); };
  $('#ed-desc', el).oninput = (e) => { spec.description = e.target.value; persist(); };
  for (const grid of $$('.emoji-grid', el)) {
    for (const b of $$('.emoji-pick', grid)) b.onclick = () => {
      const f = grid.dataset.field, e = b.dataset.e;
      sfx.tap();
      if (f === 'hero') { spec.hero = e; $$('.emoji-pick', grid).forEach((x) => x.classList.toggle('on', x === b)); }
      else if (f === 'good') { const i = spec.good.findIndex((g) => g.e === e); if (i >= 0) spec.good.splice(i, 1); else if (spec.good.length < 3) spec.good.push({ e, pts: 10 }); else toast('Up to 3 goodies'); renderPicks(); }
      else { const i = spec.bad.findIndex((g) => g.e === e); if (i >= 0) spec.bad.splice(i, 1); else if (spec.bad.length < 3) spec.bad.push({ e }); else toast('Up to 3 hazards'); renderPicks(); }
      persist();
      restartPreview();
    };
  }
  for (const b of $$('.swatch', el)) b.onclick = () => { spec.palette = Number(b.dataset.p); $$('.swatch', el).forEach((x) => x.classList.toggle('on', x === b)); setBackground(PALETTES[spec.palette]); persist(); restartPreview(); };
  for (const k of Object.keys(tpl.rules)) {
    const inp = $(`#r-${k}`, el);
    inp.oninput = () => { spec.rules[k] = Number(inp.value); $(`#rv-${k}`, el).textContent = inp.value; persist(); };
    inp.onchange = restartPreview;
  }
  $('#ed-back', el).onclick = () => { sfx.tap(); showStudio(); };
  $('#ed-test', el).onclick = () => {
    let clean;
    try { clean = ugcSanitize(spec); } catch (e) { toast(e.message); return; }
    playUgc({ id, version, owner: load().name, spec: clean, specs: {}, hero: clean.hero }, { test: true });
  };
  $('#ed-publish', el).onclick = async () => {
    let clean;
    try { clean = ugcSanitize(spec); } catch (e) { toast(e.message); return; }
    if (!(await api.ugc.available())) { toast(api.inArtifact() ? 'Sign in to Claude to publish' : "Can't reach the server – your draft is saved"); return; }
    let note = '';
    const ok = await modal(`<h2>🚀 ${version ? `Publish version ${version + 1}` : 'Publish your game'}</h2>
      <p>${clean.hero} <b>${esc(clean.title)}</b> will be playable by everyone in the community.</p>
      <label class="small">${version ? "What's new? (players see this)" : 'Release note (optional)'}<input id="pub-note" maxlength="120" placeholder="${version ? 'e.g. Easier start, new 🍩 goodie' : 'First release'}" style="width:100%"></label>
      <p class="small muted">Keep it friendly for all ages – games with several reports are hidden.</p>`, {
      buttons: [{ label: 'Publish', value: true, cls: 'green' }, { label: 'Cancel', value: false, cls: 'ghost' }], row: true,
      onOpen: (sheet) => { $('#pub-note', sheet).oninput = (e) => { note = e.target.value; }; },
    });
    if (!ok) return;
    try {
      const res = await api.ugc.publish(id, clean, note);
      update((d) => { if (d.drafts) delete d.drafts[id]; d.published = (d.published || 0) + (version ? 0 : 1); });
      sfx.win();
      announceAchievements();
      toast(`🚀 Published v${res.version}!`);
      ugcDetail(id);
    } catch (e) {
      toast(e.message || "Couldn't publish");
    }
  };
  if (!fromTest && !version && !spec.title) setTimeout(() => $('#ed-title', el)?.focus(), 300);
  restartPreview();
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
  ...ARCADE.map((g) => ({ id: g.id, label: `${g.icon} ${g.title}`, boards: [[g.id + 'Daily', '📅 Today'], [g.id + 'Week', '🗓️ This week'], [g.id, '🏆 All-time']] })),
];
const boardKey = (board) => (BOARDS[board].period === 'day' ? dayKey() : BOARDS[board].period === 'week' ? weekKey() : 'all');

function localBest(board) {
  const s = load();
  const def = BOARDS[board];
  if (def?.arcade) {
    const st = arcadeStats(def.arcade);
    return def.daily ? st.daily[dayKey()] : def.weekly ? st.week?.[weekKey()] : st.best || undefined;
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

# 🐚 Tidepop

**A free, ad-free puzzle game for all ages.** Swap cute sea creatures in a 60-level **match-3 adventure**, take on a **Daily Dive** where everyone gets the same board, chase a **weekly endless Deep Dive**, or relax with **Reef Blocks**, a block puzzle. Each mode has a **fair leaderboard**: the server replays every submitted game, so scores can't be faked.

- 💸 Free forever: no ads, no real-money purchases, no lives or timers. Boosters are bought with shells you earn by playing.
- 📱 Installable PWA: add it to the home screen on iOS or Android and play offline.
- 🧒 Built for all ages: colourblind-friendly shapes, reduced-motion mode, nicknames built from a word list, and no personal data collected.
- 🏆 End-to-end leaderboards: daily, weekly and all-time boards, each score checked by replaying the game on the server.

---

## Why this game? (research summary)

Two research agents worked on this. One did market research ([`docs/research/market-research.md`](docs/research/market-research.md)) and one brainstormed design options ([`docs/research/game-design.md`](docs/research/game-design.md)).

| Finding | Data (2025–26) | What we built |
|---|---|---|
| **Block puzzles have the most users and grow fastest** | Block Blast: #1 downloaded game in 2024 and 2025 (~368M downloads, +66% YoY), ~70M DAU / ~300M MAU (company figures). AppMagic named it the fastest-growing sub-genre. | **Reef Blocks** mode, plus a daily version |
| **Match-3 earns the most and keeps players for years** | Royal Match ~$1.37B, Candy Crush ~$1.0B (2025). Puzzle is ~44% of casual revenue. | **Adventure**: a 60-level match-3 saga |
| **Daily rituals build habits** | NYT Games: 11.2B puzzle plays in 2025, Wordle alone 4.2B | **Daily Dive** (one ranked attempt, a shareable result) and a 7-day reward calendar |
| **Puzzle suits every age** | Average player is ~41. No reading or reflexes needed. | Original sea-creature theme, no timers, no punishing lives |
| **Players dislike ads and pay-to-win** | Top block-puzzle apps rely heavily on ads | Nothing is for sale. Every reward is earned through play. |

The design agent scored four concepts (match-3 saga, endless block puzzle, merge, hybrid). The **hybrid**, match-3 plus seeded daily and endless modes, won at 18.5/20. The block-puzzle mode was added because the market research showed it has the biggest audience.

---

## Features

**Game modes**
- **Adventure**: 60 levels across 6 worlds (Sunny Shallows → Abyss Trench), with a boss level ending each world. Goals: reach a score, collect creatures, clean algae 🌿, break barnacle crates 📦, or a mix.
- **Daily Dive**: one board per day (UTC) for everyone in the world, 25 moves. Your first finished dive is ranked. If you leave mid-dive, you pick up where you left off.
- **Deep Dive**: a new endless board each week. You start with 20 moves and earn more by making specials and cascades. Your best score of the week counts.
- **Reef Blocks**: 8×8 block puzzle. Clear rows and columns, build combos, and get a bonus for a perfect clear. One undo per run, and an unfinished run is saved. Comes in Endless and Daily versions.

**Match-3 mechanics**
- Specials: **Wave** (4 in a line, clears a row or column), **Bubble Bomb** (L or T shape, clears 3×3), **Pearl** (5 in a line, clears one colour).
- Swapping two specials makes a combo: cross, giant cross, 5×5 blast, transform all, or clear the whole board.
- Cascades multiply your score. When a goal is met, leftover moves turn into Waves for the **Tidal Finale**.
- If no move is possible the board reshuffles. Holes and blockers make each layout different.
- After 7 seconds of no input a hint appears. It looks at your goals and suggests the move that helps most.

**Progression and keeping players coming back**
- 1–3 stars per level, chosen by score thresholds that a bot tuned (see [balancing](#difficulty-balancing)).
- 🐚 Shells are earned from levels, dives, achievements and daily treasure, and spent in the Shell Shop on 🔨 Hammer, 🔀 Shuffle and ➕ +5 Moves.
- A 7-day daily treasure calendar builds a login streak 🔥. Missing a day just restarts the streak; you never lose anything.
- 22 achievements, a booster gift for each first clear of every 5th level, and a new-best celebration.
- If you run out of moves, you can buy +5 moves with a booster or with shells. Retries are free and unlimited.

**Accessibility and quality**
- Each creature has its own colour **and** silhouette (crab, star, urchin, hexagon shell, jellyfish, snail).
- Settings for reduced motion (also follows the OS setting), sound effects, music and vibration.
- Play by touch-swipe, tap-tap, mouse or keyboard (arrows plus Enter; 1/2/3 to pick a block).
- Works in portrait and landscape, from 320 px wide, and respects the iPhone notch and safe areas.
- All sound is synthesised with WebAudio and all art is drawn in code. There are no image or audio assets: the whole game is about 240 KB of code, plus icons.
- Works offline (service worker) and syncs when you're back online. Progress can be exported and imported as a save code. Reset needs a two-step confirmation.

**Privacy**
- No accounts, emails, ads, analytics or trackers.
- Names are built from word lists, so nobody can enter free text and there's nothing to moderate.
- The server stores only the nickname, a random ID, a token hash and scores. IP addresses are never written to disk.
- Daily boards are deleted after 30 days and weekly boards after 12 weeks. "Delete my online scores" removes everything about you.

---

## Run it

Requires Node 18+ and **no npm dependencies**.

```bash
npm start            # game + leaderboard at http://localhost:8080
npm test             # 30 tests: engines, levels, server API, anti-cheat
npm run balance      # re-tune all 60 levels with the bot (~30 s)
```

On your phone, open the URL and choose **Add to Home Screen** to install it.

## Deploy for free

| Option | What you get | How |
|---|---|---|
| **GitHub Pages** (static) | The full game, offline-capable. Leaderboards fall back to local bests. | Enable Pages → "GitHub Actions". The workflow in `.github/workflows/pages.yml` publishes `public/` on every push to `main`. |
| **Render** free web service | Game and online leaderboard on one URL | "New → Blueprint" using `render.yaml`. *The free plan has no persistent disk, so boards reset on redeploy.* |
| **Fly.io / any VPS / home server** | Game and leaderboard with permanent storage | `docker build -t tidepop . && docker run -p 8080:8080 -v tidepop-data:/data tidepop` |
| **Split** | Static game on Pages, API anywhere | Set `window.TIDEPOP_API = 'https://your-api.example'` in `public/config.js`. CORS is open by default; restrict it with `ALLOWED_ORIGIN`. |

Server environment variables: `PORT` (default 8080), `DATA_DIR` (default `./data`), `ALLOWED_ORIGIN` (default `*`).

---

## How it works

```
public/                      ← the whole client (static, no build step)
  js/engine.js               match-3 simulation: pure, deterministic, seeded RNG
  js/blocks.js               block-puzzle simulation (deterministic)
  js/levels.js               60 level recipes (layouts + goals)
  js/level-tuning.js         GENERATED by scripts/balance.js (moves, goals, stars)
  js/modes.js                Daily / Deep / Blocks board definitions, date keys
  js/matchview.js            canvas renderer + input that animates engine "steps"
  js/blocksview.js           canvas renderer + drag-and-drop for Reef Blocks
  js/creatures.js            procedural creature sprites
  js/main.js                 screens & flows (home, map, modes, results, settings…)
  js/storage.js, api.js, audio.js, achievements.js, ui.js
  sw.js, manifest.webmanifest, icons/
server/
  server.js                  static files + API (node:http only)
  api.js                     leaderboard API with replay verification
  store.js                   atomic JSON-file storage
scripts/balance.js           difficulty balancer bot
tests/                       node:test suites
```

### Fair leaderboards (anti-cheat)
The engine is **pure and deterministic**: given a seed and a list of actions it always produces the same game, and the browser and server import the same file. A client never submits just a number. It sends the **action log** (`['s', r1, c1, r2, c2]` swaps, `['p', slot, r, c]` placements, and so on), and the server:

1. rebuilds the board from the board key (`daily:2026-11-17` → seed);
2. **replays every action** and rejects illegal moves, unfinished games and logs from a different level;
3. compares the replayed score with the claimed one and rejects any mismatch;
4. enforces the board's rules: no boosters in ranked dives, one ranked Daily Dive per player, a 2-hour grace period around midnight, an engine-version check, size limits and per-IP rate limiting.

Players are identified by a random ID plus a secret token (stored hashed), so nobody can post under someone else's name.

### Difficulty balancing
`npm run balance` makes a "casual human" bot play every level 30 times. The bot picks the most goal-useful move 75% of the time and a random move the other 25%. Its look-ahead uses a scrambled random seed, so it can't see which pieces will fall next. Move limits are chosen so the bot's win rate follows a sawtooth curve from ~97% at level 1 to ~51% at level 60, with each world ending in a harder boss level. Star thresholds come from the bot's score distribution.

---

## Roadmap ideas
- More worlds and blockers (frost, nets, kelp), which only need new level recipes.
- Friends leaderboards via share codes, and seasonal events.
- Zen mode (no move limit) for the youngest players.

## License
MIT. Theme, art, names and levels are all original.

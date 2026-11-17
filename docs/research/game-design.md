# Game Design Document: "Tidepop" (working title)

Status: Research / pre-production design. No code yet.
Platform: mobile-first PWA, vanilla HTML/CSS/JS + `<canvas>`, offline-capable, installable.
Business model: 100% free. No ads, no in-app purchases, no premium currency, no data collection.
Audience: all ages (about 6 to 99). Readable by non-readers through icons; deep enough for adults.

---

## 0. Design pillars

1. **"One more level" without pressure.** Short sessions (1-3 min), satisfying cascades, clear goals. Never punish the player for stopping or failing.
2. **Fair for everyone.** Everything that is ranked runs on identical seeded boards, with the same rules and without boosters. Nothing can be bought, because nothing is for sale.
3. **Juicy but readable.** Strong feedback (pops, chains, screen-shake you can turn off) with a board a 6-year-old can read: every piece has a unique colour AND a unique shape.
4. **Tiny and offline.** First load under about 500 KB gzipped (procedural art, no big sprite sheets). Fully playable with no network. The leaderboard is a bonus layer.
5. **Original.** Own theme, characters, names, mechanics, naming and level data. We borrow genre conventions (swap-to-match, line/bomb/colour-clear specials), not IP.

---

## 1. Candidate concepts

Scoring: 1 (poor) to 5 (excellent). Feasibility is about a small team building vanilla JS canvas plus a PWA.

| # | Concept | Description | Addictiveness | All-ages fit | Dev feasibility | Leaderboard fit | Total |
|---|---------|-------------|:---:|:---:|:---:|:---:|:---:|
| A | **Match-3 level saga** | Swap adjacent pieces, match 3+, finish objectives within a move limit, progress along a map | 5 | 5 | 4 | 2 | 16 |
| B | **Endless block puzzle** | Place tetromino-like blocks on an 8x8 or 9x9 grid and clear lines; game over when nothing fits | 4 | 4 | 5 | 4 | 17 |
| C | **Merge (2048 / merge-board)** | Merge identical items into higher tiers; endless or goal-based | 3 | 4 | 4 | 3 | 14 |
| D | **Hybrid: match-3 saga + seeded Daily/Endless modes** | Concept A for progression, plus a daily seeded fixed-move board and an endless "Deep Dive" mode, both ranked | 5 | 5 | 3.5 | 5 | **18.5** |

### Notes per concept

- **A: match-3 saga.** This is the proven retention engine (goal variety, map progression, stars). A saga alone has a weak leaderboard: level scores depend on luck and on booster use, and comparing 50 per-level boards is noisy. Cost is mostly content (levels) and the special-piece rules.
- **B: block puzzle.** It is the easiest to build, and seeded piece queues make a very fair leaderboard. Its progression is weak, it is less "candy-like" (the brief points to match-3), and it has less spectacle. It works well as a possible future side mode.
- **C: merge.** Relaxing, but the score ceiling is driven by grinding time. It feels less like the reference games, and its leaderboard is about patience, not skill.
- **D: hybrid.** It shares one match-3 engine across all modes, so the extra cost over A is small: an RNG seed source, a mode ruleset, and a score submission. It has the saga's retention, gives the leaderboard a fair format (everyone plays the identical board with identical moves), and the daily ritual gives players a reason to come back.

### Decision: Concept D (hybrid)

- One deterministic engine (`seed + ruleset + move list -> result`) serves the saga, daily, endless and server-side replay validation. That determinism is the backbone of fair ranking and anti-cheat.
- The saga gives long-term progression for kids and casual players. Daily and endless give competitive players a skill-based goal.
- The engineering risk is contained. Procedural level definitions avoid hand-authoring 50+ levels, and the solver bot used for balancing is the same engine code.

---

## 2. Theme and name

### Theme options

| Theme | Pros | Cons | Verdict |
|-------|------|------|---------|
| Gems / jewels | Easy to draw, classic | Very generic; heavily used by the genre's older titles | No |
| Fruits | Colourful, universal | Close to existing fruit match-3 games; fruit "food" vibes overlap with candy | No |
| Candy / sweets | Closest to the reference | Directly evokes the market leader, so originality and legal risk | **Avoid** |
| **Sea creatures / tide pool** | Friendly characters, natural "bubbles/pop" effects, water metaphors for specials (waves, whirlpools), gentle for kids, distinct shapes | Must keep creatures cute rather than realistic | **Pick** |
| Space / planets | Cool aesthetic | Pieces are harder to make cute and to tell apart by shape | Maybe later |
| Garden / bugs | Cute | Bugs put some players off | No |

### Name ideas

Tidepop, Reef Pop, Bubble Cove, Shellfire, Tidal Tiles, Coral Crush (too close to the reference, rejected), Splashlings, Pebble Reef, Tidy Tides.

**Pick: "Tidepop"** as the working title. It is short, verb-like and easy to say, and it ties the theme (tide pool) to the core action (pop). *Action item before launch: run a trademark and app-store name search and keep "Bubble Cove" as the fallback.*

### Cast of pieces (6 base types, colour and shape both distinct)

| Piece | Colour | Silhouette (for colourblind players) | Personality |
|-------|--------|---------------------------------------|-------------|
| Crab | Red `#E5484D` | Wide rounded triangle with claws | Grumpy-cute |
| Starfish | Orange `#F28C28` | 5-point star | Cheerful |
| Pufferfish | Yellow `#F5C518` | Circle with spikes | Surprised |
| Turtle | Green `#3DAA5C` | Hexagon (shell) | Calm |
| Fish | Blue `#2F80ED` | Diamond / rhombus | Speedy |
| Snail shell | Purple `#9B51E0` | Spiral square | Shy |

Early levels use 4-5 types and later levels use 6. All pieces are drawn procedurally on canvas (paths plus gradients) or cached to offscreen canvases at startup. No image assets are needed for the pieces.

Mascot / guide: **"Pip" the hermit crab**, who appears in tutorials and hints and in the empty states. Every world is a section of the coast: Sandy Shallows, Kelp Forest, Coral Gardens, Sunken Ship, Moonlit Lagoon, and so on.

---

## 3. Core gameplay

### 3.1 Core loop

```
Map/Daily -> Level intro (goal + moves) -> Swap -> Match -> Clear -> Gravity/refill -> Cascade? -> (repeat)
   -> Goal met: leftover moves become specials ("Tidal Finale") -> stars -> rewards -> next level
   -> Out of moves: "So close!" screen -> retry free (no lives lost) / use an earned booster
```

Micro loop (seconds): swap, pop, cascade, dopamine.
Session loop (minutes): finish the level, earn stars, chest progress, unlock the next node.
Meta loop (days): daily streak, daily challenge rank, worlds unlocked, achievements, collection album.

### 3.2 Board and input

- Grid 8x8 by default, varying from 7x7 to 9x9. Cells can be "holes" (non-playable) to shape boards.
- Input is a swipe on a piece, or tap A then tap adjacent B. A swap that makes no match animates back (no move is consumed).
- A tap-to-select mode with a highlighted selection supports accessibility and mouse users.
- **Resolution order (deterministic):**
  1. Apply the swap. If a special is involved in a special+special swap, resolve the combo.
  2. Find all matches (horizontal and vertical runs of 3+, merged into shapes by shared cells).
  3. Decide which special each shape creates, placed at the swapped cell if it is in the shape, else at the shape's lowest-then-leftmost cell.
  4. Clear the matched cells and damage adjacent blockers. Trigger specials hit by the clear (chain).
  5. Gravity: pieces fall straight down (diagonal slide into gaps under holes as a later-world mechanic).
  6. Refill from the top using the board's RNG stream.
  7. Repeat from step 2 until stable. Each repeat is a **cascade** step, and the score multiplier rises with each.
  8. Check goals. Check for available moves; if none, **reshuffle** (see section 6).

### 3.3 Special pieces (original names)

| Match shape | Special created | Effect when matched or activated |
|-------------|----------------|----------------------------------|
| 4 in a line (horizontal) | **Wave** (horizontal) | Clears the whole row |
| 4 in a line (vertical) | **Wave** (vertical) | Clears the whole column |
| 2x2 square | **Seahorse** | Darts to a goal-relevant cell (the blocker or target colour that is most needed; ties broken by the seeded RNG) and clears it plus its neighbours in a cross |
| L or T shape (5 cells) | **Bubble Bomb** | Clears a 3x3 area, then pops again once after landing (a second 3x3) |
| 5 in a line | **Pearl** (colour clear) | Swap with any piece to clear every piece of that colour |

Rule: the Wave direction follows the orientation of the match. A Wave made from a vertical 4-match clears a column. This is simple and predictable.

### 3.4 Combos (special + special swap)

| Combo | Effect |
|-------|--------|
| Wave + Wave | Clears a cross (row + column) |
| Wave + Bubble Bomb | Clears 3 rows + 3 columns ("Big Splash") |
| Wave + Seahorse | Seahorse carries a Wave to its target, which then fires |
| Bubble Bomb + Bubble Bomb | 5x5 explosion, twice |
| Bubble Bomb + Seahorse | Seahorse carries a Bomb to its target |
| Seahorse + Seahorse | 3 Seahorses launch |
| Pearl + normal piece | Clears all pieces of that colour |
| Pearl + Wave | Every piece of the most common colour becomes a Wave and fires |
| Pearl + Bubble Bomb | Every piece of the most common colour becomes a Bomb and fires |
| Pearl + Seahorse | Every piece of the most common colour becomes a Seahorse |
| Pearl + Pearl | **"Tsunami"**: clears the whole board (blockers take 1 hit each) |

### 3.5 Scoring (identical in every mode, so scores are comparable)

- Base: 3-match = 60, plus 20 per extra piece in the shape.
- Creating a special: +100 (Wave/Seahorse), +150 (Bomb), +200 (Pearl).
- Pieces cleared by specials: 30 each. Blocker layer removed: 50.
- Cascade multiplier: step 1 is x1, step 2 x1.5, step 3 x2, step 4 x2.5, capped at x5. Combos add a flat bonus (300 to 2000).
- **Tidal Finale** (saga only): when the goal is met, each remaining move turns a random piece into a Wave that fires, at +250 per move. This rewards efficiency and is a classic "jackpot" feeling.
- Scores are integers with no time-based component, so replays are deterministic.

### 3.6 Blockers (original variants)

| Blocker | Analogue | Behaviour | Introduced |
|---------|----------|-----------|-----------|
| **Frost** (1-2 layers) | Ice | Covers a piece. A match on that cell removes one layer. The piece can still be swapped | World 1, level 6 |
| **Barnacle Crate** (1-3 layers) | Crate / box | Occupies a cell, cannot be moved. Damaged by an adjacent match or by any special hitting it. Blocks gravity | World 1, level 10 |
| **Algae** (spreads under pieces) | Jelly | Lies under pieces. Clearing a piece on it cleans it. The goal is often "clean all algae" | World 2 |
| **Net** | Chain / lock | Locks a piece in place (cannot be swapped) but the piece can match. A match frees it | World 2 |
| **Kelp** (grows) | Spreading blocker | If no kelp was hit on a turn, one adjacent cell grows kelp. Teaches urgency | World 3 |
| **Treasure Chest** (collectible) | Drop-down ingredient | Falls with gravity; collected when it reaches an exit cell at the bottom | World 3 |
| **Clam** (opens/closes) | Toggle blocker | Alternates open/closed every 2 moves; can only be hit while open | World 5 (later) |

Rule: the MVP ships Frost, Barnacle Crate, Algae and Net. Kelp, Treasure and Clam come in v1.1 once the engine is stable.

### 3.7 Objectives

| Objective type | Example | Notes |
|----------------|---------|-------|
| Score | "Reach 8,000 points" | Only in early tutorial levels and as a bonus |
| Collect | "Collect 20 Crabs + 15 Fish" | The most common objective; teaches focus |
| Clear Frost | "Break all Frost" | |
| Clean Algae | "Clean all Algae" | Forces board coverage |
| Break Crates | "Break 12 Crates" | |
| Rescue Treasure | "Bring 3 Chests ashore" | v1.1 |
| Mixed | Up to 3 goals at once | From World 3 |

### 3.8 Move limits and stars

- Every saga level has a **move limit** (no timers in the saga, so it is calm and accessible). Range: 15-35 moves.
- **Stars** come from score thresholds, computed per level from the balancing bot (see 3.10):
  - 1 star: goal completed (always, whatever the score).
  - 2 stars: score >= the bot's median completion score.
  - 3 stars: score >= the bot's 85th percentile completion score.
- Thresholds are rounded to "nice" numbers (to the nearest 500) and shown on the progress bar.

### 3.9 Level definition format (procedural, data-driven)

Levels are **not** hand-placed boards. Each level is a compact recipe that the engine expands deterministically:

```
{
  id: 23,
  seed: 0x5A17_0023,          // fixed per level so every player sees the same layout
  size: [8, 9],
  holesPattern: "notchCorners", // named template from a small library
  colors: 5,
  moves: 24,
  goals: [{type: "collect", piece: "crab", n: 18}, {type: "frost", n: "all"}],
  blockers: [{type: "frost", layers: 1, pattern: "centerDiamond"}, {type: "crate", layers: 2, pattern: "bottomRow", count: 6}],
  stars: [1, 9000, 14500]      // filled in by the tuning tool
}
```

- About 25 shape and blocker **pattern templates** (diamond, ring, checker, stripes, corners, centre box, ...) are mirrored and rotated by the seed for variety.
- A **level generator script** (dev-time, Node) produces the definitions from the difficulty curve. The output is committed as a small JSON file (about 10-20 KB for 100 levels), so content is reviewable and stable between versions.
- The initial board is generated without pre-existing matches, and with at least one valid move guaranteed.

### 3.10 Difficulty curve for 60 launch levels (6 worlds x 10)

Difficulty knobs: number of colours (4, 5 or 6, the strongest knob), moves vs. goal size, blocker density and layers, holes, and goal count.

| World | Levels | Colours | Moves | New mechanic | Target first-try win rate (bot-estimated) |
|-------|--------|---------|-------|--------------|------------------------------------------|
| 1 Sandy Shallows | 1-10 | 4, then 5 from level 4 | 30 down to 22 | Swaps, Wave (L2), Bomb (L3), Seahorse (L5), Pearl (L7), Frost (L6), Crate (L10) | 95% down to 80% |
| 2 Kelp Forest | 11-20 | 5 | 22-28 | Algae, Net | 80% down to 65% |
| 3 Coral Gardens | 21-30 | 5 (6 on "boss" levels) | 20-28 | Kelp growth, Treasure, mixed goals | 70% down to 55% |
| 4 Sunken Ship | 31-40 | 5-6 | 20-30 | Multi-layer crates, hole-heavy shapes | 65% down to 50% |
| 5 Moonlit Lagoon | 41-50 | 6 | 18-30 | Clam, everything combined | 60% down to 45% |
| 6 Storm Reef | 51-60 | 6 | 18-30 | Remix of all; "hard" levels marked with a wave icon | 55% down to 40% |

- **Sawtooth pacing**: within each 10, levels 1-3 are easy, 4-7 medium, level 8 is a breather, level 9 is hard, level 10 is a "boss" (hard, with a chest reward). This avoids difficulty walls.
- **Balancing bot** (dev tool): a greedy-plus-lookahead AI (it prefers goal progress, special creation and combos) plays each level about 500 times with different refill seeds. That gives a win rate, a score distribution and the star thresholds. Moves are adjusted until the win rate lands in the target band. The same bot powers in-game hints.
- **Refill seed vs. layout seed**: the layout is fixed per level. Refills in the saga use a per-attempt seed, so retrying a level gives fresh luck, which is good for casual play. Daily and Endless use a fixed refill seed (fair ranking).
- **Dynamic help (gentle, transparent)**: after 3 failed attempts on a level, offer a free "Helper Splash" (1 Bubble Bomb pre-placed). After 5 failures, +3 moves. Never hidden difficulty manipulation. The help is always visible and optional.
- **Beyond level 60**: new worlds of 10 levels ship as data-only updates. Optionally, "Endless Saga" generates levels 61+ procedurally from the curve formula (level index sets colours, moves and blocker density) with an automated bot check at generation time.

---

## 4. Modes

| Mode | Board | RNG | Moves | Boosters | Ranked? |
|------|-------|-----|-------|----------|---------|
| **Adventure** (saga) | Level recipe | Layout fixed, refill per attempt | Per level | Allowed | No (stars only, personal) |
| **Daily Dive** | Generated from date seed | Fully seeded (layout + refill) | Fixed 25 | **Disabled** | **Yes**, daily board |
| **Deep Dive** (endless) | Generated from weekly seed | Fully seeded | Starts at 20; +1 move per Wave/Seahorse made, +2 per Bomb, +3 per Pearl, +5 per combo | **Disabled** | **Yes**, weekly board |
| **Free Play / Zen** | Random | Random | Unlimited, no score | n/a | No (relaxation, for young kids) |

### Daily Dive details

- Seed = `hash("tidepop-daily-v1:" + YYYY-MM-DD in UTC)`. Everyone worldwide plays the same board in the same UTC day. Each day the board draws a rotating "twist" (e.g. Frost day, Crate day, 6-colour day) from the seed.
- **One ranked attempt per day.** Unlimited practice attempts on the same board are allowed after the ranked one (not ranked). That gives a fair one-shot competition with no grinding. *Alternative considered: best of 3 attempts. Rejected, because it encourages replay-scumming once the board is memorised, and one attempt keeps sessions short.*
- Because the refill is seeded, the result is determined only by the player's move choices. Pure skill.
- The result screen shows score, percentile ("better than 72% of divers today") and a shareable emoji grid (a text summary with no personal data).

### Deep Dive (endless) details

- A weekly seed (ISO week, UTC). The player can retry as often as they like during the week; their best run counts.
- Moves are earned by making specials, so skill extends the run. Difficulty ramps: every 2,000 points, one more colour (up to 6) and a blocker row creeps up from the bottom.
- The run ends when moves reach 0. Personal best is stored locally; the weekly best is submitted.

---

## 5. Retention systems (generous, never punitive)

### 5.1 Lives / energy

**No lives.** Unlimited retries. Failing a level costs nothing but the time spent. This is the strongest pro-player choice and suits a no-monetisation game: the reference games use lives to sell refills, and we have nothing to sell. Session pacing comes from goals and the daily ritual instead.

### 5.2 Daily reward streak ("Tide Calendar")

- 7-day cycle, rewards escalating: Day 1: 1 Shovel; 2: 50 shells; 3: 1 Bubble Bomb start; 4: 1 Extra Moves; 5: 100 shells; 6: 1 Pearl start; 7: a chest (3 random boosters plus a cosmetic piece).
- **Forgiving streak:** missing one day does not reset the streak; it pauses. After 2 or more missed days the streak steps back by one tier rather than resetting to 0. Never use guilt messaging ("You lost your streak!"). Use "Welcome back! Your tide calendar is waiting."
- Claim from the home screen. It is based on the local date; the clock-change exploit is accepted (rewards are cosmetic and boosters that do not affect ranked modes, so there is nothing to protect).

### 5.3 Soft currency: Shells

- Earned only by playing: level win (10 + 5 per star, first time), daily participation (20), achievements, the streak.
- Spent on boosters (below) and cosmetic **board themes** (sand, night, coral pink, high-contrast) and **piece skins** (hats on creatures).
- There is no way to buy Shells. Prices are tuned so a regular player can always afford a booster when stuck.

### 5.4 Boosters (saga only, all earned)

| Booster | Type | Effect |
|---------|------|--------|
| **Shovel** | In-level | Removes 1 piece or 1 blocker layer (no move used) |
| **Swap Shell** | In-level | Swaps any two adjacent pieces even without a match (no move used) |
| **Riptide** | In-level | Clears a whole row of your choice |
| **Extra Moves** | Post-fail | +5 moves when out of moves |
| **Bubble Start / Pearl Start** | Pre-level | Starts the level with that special on the board |

Boosters are **never** usable in Daily Dive or Deep Dive, so they cannot distort the leaderboard.

### 5.5 Achievements ("Shell Collection")

About 40 badges in tiers (bronze, silver, gold). Examples:
- Progress: complete World 1-6; earn 30/90/180 stars.
- Skill: make a Tsunami (Pearl+Pearl); cascade 6+ times in one move; finish a level with 10+ moves left.
- Ritual: play the Daily 7/30/100 days (not consecutive, so it is forgiving); finish a Deep Dive with 50k+ points.
- Discovery: try every combo once (tracked in a "Combo Book" that teaches combos by itself).
- Kind/fun: "Pet Pip 10 times" on the home screen, for kids.

Each gives shells and is shown in a grid with locked silhouettes, so players can see what is collectible.

### 5.6 Hints

- An idle hint: after 5 s of no input (adjustable: 3/5/10 s/off), gently wiggle the best move chosen by the bot heuristic (it prefers goal-relevant moves and special creation).
- Hints are free and unlimited. In Daily/Deep Dive, idle hints are **on for everyone or off for everyone**, defaulting to a delayed 10 s hint. The setting does not affect fairness because everyone has the same access. Option: show a "hint used" badge on the scoreboard entry, unranked.

### 5.7 Other gentle hooks

- **Star chests:** every 20 stars opens a chest (boosters and shells).
- **World completion postcard:** a collectible illustration for each world (procedural art).
- **Daily goal card:** "Make 5 Waves today" style micro-quests (3 per day, seeded, worth a few shells).
- **No push notifications at launch.** A PWA can do push but it needs a backend plus consent; kids audience; not needed. Possible later as an explicit opt-in "Daily reminder".

---

## 6. Leaderboard scenarios

### 6.1 Options

| Scenario | How | Pros | Cons | Verdict |
|----------|-----|------|------|---------|
| **L0: Offline only** | Local personal bests; "Rival" ghost scores generated from the bot's distribution for that seed ("Bot Captain scored 18,200") | Zero cost, zero privacy issues, works offline, always available | Not a real social competition | **Ships first, always available as fallback** |
| **L1: Static file plus PRs / Gists** | Scores collected manually | Free | Not scalable, slow | No |
| **L2: Free serverless backend (Cloudflare Workers + D1 or KV)** | A small API: submit and fetch top-N per board; the Worker re-simulates the replay | Free tier is generous (100k requests/day), global edge, JS on both sides means the **engine module can be shared** | Needs a Cloudflare account, small ops | **Recommended online option** |
| L2b: Supabase free tier (Postgres + edge functions) | Same API shape | SQL, row-level security | Free projects pause after inactivity; Deno edge function for validation | Good alternative |
| L2c: Self-hosted Node + SQLite on a free/cheap VM | Same API | Full control | Ops burden, uptime | Fallback |
| L3: Firebase / game-service SDKs | Hosted leaderboards | Fast to build | Third-party tracking / account systems, heavier SDK, privacy questions for kids | Avoid |

**Decision:** design the client against a tiny `LeaderboardProvider` interface with two implementations: `LocalProvider` (L0, default) and `RemoteProvider` (L2, Cloudflare Worker). The game must be complete and fun with only L0. If the remote is unreachable the UI falls back silently to "Offline: showing your scores" and queues submissions (IndexedDB outbox) to retry when online, until the board closes.

### 6.2 Remote API sketch (no code; contract only)

- `GET /board/{boardId}/top?n=50` returns `[{rank, nick, score, flags}]` (cached at the edge for 60 s).
- `GET /board/{boardId}/around/{playerId}` returns the player's rank with 5 entries above and below.
- `POST /submit` with `{boardId, playerId, nick, engineVersion, moves:[...], claimedScore, startedAt, durationMs}`.
- `boardId` = `daily-2026-11-17` or `deep-2026-W47`. Boards older than 30 days are archived (keep the top 100 only).

### 6.3 Anti-cheat basics (proportionate for a free game)

1. **Deterministic seeded replays.** The client sends the **move list**, not just a score. The server runs the same engine (the shared ES module, pinned to `engineVersion`) with the board's seed and computes the authoritative score. If `claimedScore != replayScore`, the entry is rejected. This defeats score editing completely; the only "cheat" left is playing well (or bot-assisted play, see 4).
2. **Sanity limits.** Reject when: the move count is larger than the mode allows; the score is above the mode's theoretical cap (computed offline with the bot plus margin); `durationMs` is under about 0.4 s per move (humans need animation time); the timestamp is outside the board's window (plus a 2 h grace for queued offline submits).
3. **One ranked submission per player per daily board.** The server keeps the first. Deep Dive keeps the best, with up to about 50 submissions per week per player.
4. **Rate limiting** per IP and per `playerId` (Worker plus Cloudflare's built-in tools). Bot-assisted perfect play: accept the risk; optionally flag entries above the bot's 99.9th percentile for hiding until reviewed.
5. **Engine version pinning.** Keep old engine versions available server-side for the life of a board, so a client update mid-day does not invalidate replays. Bump `engineVersion` whenever the rules change.
6. **No secrets in the client.** Request signing in the PWA would be trivially extractable, so it gives no real security. Replay validation is the real defence.

### 6.4 Identity and nickname moderation

- **No accounts, no email, no login.** On first launch, generate a random `playerId` (UUID v4) in local storage. It is not linked to any personal data.
- **Nicknames are built from word pickers, not typed free text:** `[Adjective] + [Sea creature] + [2-digit number]`, e.g. "Bubbly Otter 42", "Brave Squid 07". About 150 adjectives x 80 creatures x 100 numbers gives about 1.2M combinations. All words come from a curated, kid-safe list. This **eliminates moderation work and the risk of exposing real names**, which is ideal for a kids audience.
- The player can re-roll or pick words from dropdowns. The server validates that the nickname is made of words from the allow-list (the same list is shipped server-side).
- An optional later version could allow free text for adults, behind a profanity and PII filter (no digits sequences longer than 3, no @, no URLs) plus a report button. **Not at launch.**
- Avatar: choose one of the 6 creature icons and a colour. No image uploads.

### 6.5 Kids privacy (COPPA / GDPR-K / UK Age Appropriate Design Code posture)

- Collect **no personal data**: no names, emails, location, contacts, device fingerprints, or third-party analytics/ads SDKs. No cookies other than the app's own local storage.
- `playerId` is random and pseudonymous, and the nickname comes from the allow-list, so the system cannot hold PII by construction.
- The server stores only: playerId, nickname, avatar index, boardId, score, moves (for re-verification), engineVersion, timestamps. It does **not** store IP addresses (only short-lived in-memory rate-limit counters). Data is retained for 30 days for daily boards and 12 weeks for weekly boards, then deleted (top-100 archive stores nickname and score only).
- **Leaderboard is opt-in:** online submission is off until the player taps "Join the leaderboard" (a one-time, kid-readable explanation: "Your fun name and score will be shown to other players. Nothing else is shared."). Settings has a "Leave the leaderboard and delete my scores" button, which calls `DELETE /player/{id}`.
- A privacy page in plain language, shown in-app and offline.
- No chat, no friend lists, no user-generated content: no social risk surface.

---

## 7. Edge cases and scenarios

### 7.1 Board logic

| Scenario | Handling |
|----------|----------|
| **No possible moves** | After every stable state, scan for a valid swap (including special+special swaps and Pearl swaps, which are always valid). If none: show "No moves, shuffling!", animate a shuffle that keeps blockers and specials in place, guarantees at least 1 valid move, and creates no immediate matches. Uses the board RNG stream (deterministic for replays). After 10 failed shuffle tries (very constrained boards), regenerate the movable pieces from scratch. No move is consumed. |
| **Initial board has matches** | The generator rejects and re-rolls individual cells until there are none; guarantee at least one valid move. |
| **Long cascades** | There is no hard cap, but animation speeds up after cascade 5 (shorter tweens) to avoid waits. A safety loop limit (e.g. 200 iterations) logs an error and stops, to prevent infinite loops from bugs. |
| **Goal met mid-cascade** | Let the cascade finish (score counts), then Tidal Finale. |
| **Goal met and moves 0 at the same time** | Counts as a win. |
| **Last move creates a cascade that completes the goal** | The win is evaluated only after the board is stable. |
| **Special triggers another special** | Queue-based chain resolution in deterministic order (by activation time, then reading order) so the result is identical on client and server. |
| **Seahorse with no goal target** | It targets a random non-empty cell from the seeded RNG. |
| **Pearl + Pearl on a board with blockers** | Clears all pieces; blockers take 1 hit each (not instant removal). |
| **Input during animation** | Queue at most 1 swap; ignore others. Prevent double-swap races. |
| **Treasure stuck above a crate** | Level validation (bot) guarantees solvability; gravity rules let treasure slide diagonally only when diagonal fill is enabled. |
| **Kelp covers the whole board** | Kelp cannot grow onto specials or goal-critical cells; the bot validates a minimum winnable rate. |
| **Floating-point drift** | All engine maths in integers; the RNG is integer-based (e.g. mulberry32 / sfc32 with a fixed algorithm), with no `Math.random()` in the engine. |

### 7.2 Session and app

| Scenario | Handling |
|----------|----------|
| **App backgrounded / tab closed mid-level** | Autosave the level state (seed, moves played, booster uses) after every move. On return, offer "Continue level?" and rebuild by replaying the moves (deterministic). |
| **Daily ranked attempt interrupted** | It resumes from the saved move list; the attempt is not lost. If it is never finished before the UTC day ends, submit the score as it stands at the end of the window (or mark it "unfinished"; do not penalise). |
| **Daily rolls over during play** | The board is locked at its start date; submit to that date's board within the 2 h grace. |
| **Offline** | Everything except the remote leaderboard works. A Daily seed needs no server (date-derived). Submissions go to the outbox. A small cloud icon shows the sync state. |
| **Device clock wrong** | Daily uses the local UTC date; the server rejects submits for boards outside its window ("Your device date looks off"). Local rewards are unaffected. |
| **Storage cleared / private mode** | Detect when storage is unavailable or quota is 0; show "Progress can't be saved in this mode" once; the game still runs in memory. |
| **Multiple tabs open** | Use a `BroadcastChannel` lock: the second tab shows "Tidepop is open in another tab." |
| **App update while playing** | The service worker uses "update available, refresh when you finish this level"; never force a reload mid-level. Version the saves and migrate (see 7.4). |

### 7.3 Accessibility

- **Colourblind:** every piece has a unique silhouette (section 2); specials have distinct overlays (stripes for Wave, ring for Bomb, sheen for Pearl, seahorse icon). An optional "symbols" mode adds a high-contrast glyph inside each piece. Colours are tested against deuteranopia, protanopia and tritanopia simulations.
- **Reduced motion:** respect `prefers-reduced-motion` by default, with an in-game toggle. This disables screen-shake, particles and parallax and uses short fades instead of bounces. Gameplay timing still works.
- **Sound:** separate toggles for Music, Sound effects and Haptics (`navigator.vibrate` where supported). Audio starts muted until the first user interaction (browser autoplay rules). Volume persists. All sounds are synthesised with WebAudio or are tiny files, all original.
- **Visual:** high-contrast board theme; UI text at least 16 px; tap targets at least 44x44 CSS px; "Large board" option (hides decorative chrome).
- **Motor:** tap-tap mode (no swipe needed); adjustable swipe sensitivity; no time pressure in the saga; no time limit in Daily.
- **Cognitive / kids:** icon-first goals (picture of a crab x 18), short sentences, Pip shows rather than tells; an optional "Simple mode" (Zen) with no move limit.
- **Screen readers:** the canvas board cannot be fully narrated, but all menus are real DOM buttons with labels. The game board exposes an ARIA live region announcing goal progress and moves left. Keyboard play on desktop: arrow keys move a cursor, Space/Enter selects and swaps.
- **Language:** strings live in a locale file from day 1 (English first; designed for translation; no text baked into graphics).

### 7.4 Layout, devices, persistence

| Topic | Approach |
|-------|----------|
| **Portrait (primary)** | Top HUD (goals, moves, score bar with star ticks), board centred, bottom booster bar. |
| **Landscape** | HUD moves to a left side panel, boosters to a right panel, and the board takes the full height. The layout is computed from the viewport aspect ratio on `resize`. Orientation is not locked (the manifest uses `"orientation": "any"`). |
| **Small screens (320 px wide, e.g. older phones)** | Cell size = `min(availableW / cols, availableH / rows)` with a 32 px minimum. HUD collapses to compact icons. Tested at 320x568. |
| **Large / tablet / desktop** | Cap the board at about 640 px, centre it with decorative side art. Mouse and keyboard supported. |
| **High-DPI** | Canvas backing store scaled by `devicePixelRatio` (capped at 2 for performance). |
| **Safe areas / notches** | `env(safe-area-inset-*)` padding; `viewport-fit=cover`. |
| **Performance** | Target 60 fps on mid-range Android; pre-render pieces to offscreen canvases; draw only dirty regions where easy; pause the loop when hidden (`visibilitychange`). Battery-saver option at 30 fps. |
| **Persistence** | `localStorage` for small settings; IndexedDB for progress, the autosave and the outbox. Schema: `{version, playerId, nick, settings, progress:{levels:{id:{stars,best}}}, currency, boosters, achievements, streak, dailyHistory, deepBest}`. Versioned migrations on load. Request `navigator.storage.persist()` after the first level win to reduce eviction risk. |
| **Backup / transfer** | Settings has "Export progress" (copy a base64 code or download a `.json` file) and "Import progress" (validated, with confirmation). No cloud account is needed. |
| **Reset progress** | Settings > "Reset all progress". Two-step confirmation ("Type RESET" for adults, or hold a button for 3 s, kid-proof). Explain what is lost. Optionally also delete leaderboard entries. The `playerId` is regenerated. |
| **Corrupted save** | Validate on load; if invalid, keep the last-good backup copy (written alternately to 2 keys), else start fresh with a polite message. |
| **PWA install** | A custom "Add to Home Screen" prompt after level 5 (never on first launch). iOS shows manual instructions (Share > Add to Home Screen). The service worker precaches all assets (cache-first, versioned), so it works fully offline after the first load. |

---

## 8. End-to-end user flow (screen list)

```
[Splash/Boot] -> first launch? -> [Welcome + Pip intro] -> [Tutorial Level 1 (guided)] -> [Level Complete] -> [Map]
                 returning?   -> [Home/Map] (+ [Daily Reward popup] if claimable) (+ [Continue level?] if autosave)
```

| # | Screen | Purpose and key elements | Leads to |
|---|--------|--------------------------|----------|
| 1 | **Boot / Splash** | Logo, loading of cached assets (under 1 s offline), migration of saves | 2 or 3 |
| 2 | **First-run Welcome** | Pip says hi; one tap "Let's play!"; no sign-up, no permissions asked | 7 (Tutorial L1) |
| 3 | **Home / World Map** | Scrollable coastline path of level nodes with stars; current node pulses; top bar: shells, settings gear; bottom nav: Adventure, Daily, Deep Dive, Collection | 6, 11, 13, 16, 18 |
| 4 | **Daily Reward popup** | Tide Calendar 7 tiles, claim button, streak info | 3 |
| 5 | **Continue Level? popup** | Resume an interrupted level / Discard | 8 |
| 6 | **Level Intro (pre-level)** | Level number, goal icons, moves, star targets, choose pre-level boosters (optional), Play | 8 |
| 7 | **Tutorial overlays** | Hand pointer, dimmed board with a highlighted swap, one-line tips (Pip); used for each new mechanic | 8 |
| 8 | **Gameplay** | HUD: goals with counters, moves left, score bar with 3 star ticks, pause; board; booster bar (saga only) | 9, 10, 12 |
| 9 | **Pause menu** | Resume, Restart, Settings (sound/motion), Quit to map | 8, 3, 17 |
| 10 | **Out of Moves ("So close!")** | Show remaining goals; options: +5 moves (if the booster is owned), Retry (free), Map; after 3 fails, the "Helper Splash" offer | 8, 6, 3 |
| 11 | **Level Complete** | Tidal Finale animation, stars, score, shell reward, chest progress, Next / Replay / Map | 6 (next), 3 |
| 12 | **Reshuffle toast** | In-game banner "No moves, shuffling!" (non-blocking) | 8 |
| 13 | **Daily Dive Lobby** | Today's twist, countdown to the next board, "Ranked attempt" or "Practice", your rank if played, mini top-10 | 8 (daily), 15 |
| 14 | **Daily/Deep Result** | Score, percentile, rank, personal best, share-text button, "Join leaderboard?" prompt (first time) | 15, 3 |
| 15 | **Leaderboard** | Tabs: Today / Yesterday / This Week (Deep Dive) / My Bests; Top 50 + "around me"; offline badge; Bot Captain rival when offline | 3, 13 |
| 16 | **Deep Dive Lobby** | Weekly best, week countdown, rules summary, Play | 8 (endless), 15 |
| 17 | **Settings** | Music / SFX / Haptics, Reduced motion, Colourblind symbols, High contrast, Hint delay, Swipe vs. tap, Language, Nickname and avatar, Leaderboard opt-in/out, Export / Import progress, Reset progress, Privacy, Credits, Version | 19, 20, 21 |
| 18 | **Collection** | Tabs: Achievements (badges), Combo Book, Postcards, Cosmetics shop (spend shells on themes/skins), Booster inventory | 3 |
| 19 | **Nickname Picker** | Adjective / creature / number wheels, re-roll dice, avatar creature and colour | 17, 14 |
| 20 | **Reset / Export / Import dialogs** | Confirmations as described in 7.4 | 17 |
| 21 | **Privacy & About** | Plain-language privacy promise, "free forever, no ads" note, credits, open-source licences | 17 |
| 22 | **World Unlocked / Chest Open** | Celebration interstitial with postcard and rewards | 3 |
| 23 | **Install prompt (PWA)** | After level 5: "Add Tidepop to your home screen to play offline" | 3 |
| 24 | **Update available toast** | "New version ready, refreshes after this level" | n/a |
| 25 | **Error / Offline notices** | Non-blocking toasts: "Offline: scores will sync later", "Storage unavailable" | n/a |

---

## 9. Scope and milestones (suggested)

1. **M1: Engine core.** Grid, swap, matching, gravity, refill, seeded RNG, cascades, scoring, reshuffle, the 4 specials and the combos. A headless test harness (deterministic replay tests).
2. **M2: Saga MVP.** 30 levels (Worlds 1-3, with Frost, Crate, Algae, Net), map, stars, level intro/complete/fail, save/load, settings, accessibility basics, PWA offline.
3. **M3: Daily + Deep Dive + local leaderboard (L0)**, achievements, daily streak, boosters, shells.
4. **M4: Remote leaderboard (L2)** with replay validation, nickname picker, opt-in flow.
5. **M5: Content to 60 levels** (Worlds 4-6, with Kelp, Treasure, Clam), cosmetics, polish, localisation.

## 10. Open questions

- Final name after the trademark search (Tidepop vs. Bubble Cove).
- Should a 2x2 square special (Seahorse) be in the MVP or in M3? It adds the most complex rules (targeting).
- The Daily "one ranked attempt" vs. "best of 3": validate with playtests.
- Whether to show the leaderboard to under-13s by default (we currently make it opt-in for everyone, which avoids the question).
- Music: commission or generate original chiptune/ambient loops; keep the total audio under 300 KB.

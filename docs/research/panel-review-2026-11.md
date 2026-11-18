# Panel review & brainstorm (Nov 2026)

13 agents reviewed the code (read-only), several played it in a browser and/or researched the market: a game-design/live-ops lead, a UX & accessibility designer, a growth & monetisation strategist, a harsh critic, and genre specialists for every game (match-3, block puzzle, chess, ludo, cube, daily puzzle, 8 arcade games, creator studio).

## Verdict
Critic: **5/10** – "a well-engineered demo… 14 clones of games people already play better elsewhere, plus a lot of meta. Most commits add features; none deepen a game." Engineering (deterministic sims, server replay, PWA, cloud save) is praised by everyone; **focus, depth and feel** are the gaps.

## Where the panel agrees
1. **Identity is blurred.** "Tidepop" names the brand, the match-3, Tide of the Day and the Tide Pool; chess/ludo/cube don't fit the ocean theme; the first screen shows no games (countdowns, Tide, Pip, Hot, missions first). (critic, UX)
2. **Breadth over depth.** Most arcade games are ~150-line sims without a hook; specialists independently propose one *distinctive* twist each (below). (critic, all gamers)
3. **Feel/feedback is thin.** No hit-stop/shake, silent state changes (Sort Splash swaps the solved puzzle instantly; Crab Catch escapes are silent), input locked during cascades (match-3), slow retries (Puffer 900 ms + modal), stepped snake movement, cube swipes lost during animation.
4. **The economy runs dry.** All Tide Pool decor ≈ 4,190 🐚 ≈ two weeks of play; comfort caps at 5★; then shells are worthless for 12 of 14 games. Nothing between "today" and "forever" (no seasons/events); weekly prizes only for the global top 10. (live-ops)
5. **The real edge is the deterministic replay engine** → ghost races / async PvP on the same seed (block puzzle, match-3, serpent, puffer all suggested it), cheat-proof daily boards, and the daily share loop. (gamers, growth, critic)

## Bugs & fixes found (do first)
| Issue | Where |
|---|---|
| Tide of the Day share text **is the solution** (exact colour sequence) | tide.js `shareText` |
| Tide par from a weak greedy solver (beatable by up to 5); par+3 limit → 92% of days solved by a sloppy bot | tide.js `solve`, `TideSim` |
| `aria-live` on `<main>` makes screen readers read the timer every second; `user-scalable=no` blocks zoom (WCAG 1.4.4) | index.html |
| Device "reduce motion" ignored; storm lightning flashes on by default (photosensitivity) | storage.js, cozy.js |
| "Daily!" badge on every card; low-contrast badge text | main.js hub, style.css |
| Cube: swipes during a turn animation become camera drags | cube-view.js `draw`/`pick` |
| Cube late-stage allowance drops to 45 (below expert solves); undo costs a twist | cube.js `stagePlan`, `twist` |
| Chess "Master ~1900" plays ~1400; bot search blocks the main thread (up to ~1.9 s) | chess.js levels, chess-view.js |
| Match-3 refills spawn under crates/holes (nothing ever trapped) | engine.js `gravity` |
| Block puzzle trays can be unplaceable in any order; no fair-generation check | blocks.js `refill` |
| Ludo online dice predictable from the shared seed | versus.js `rebuild` |
| UGC: ratings not restricted to players/non-owners; 3 reports silently hide a game | server/api.js `handleUgc` |
| README says 13 games (there are 14); "names from word lists" no longer true; manifest says "ad-free"; manifest category "kids" | README, manifest |
| No Open Graph tags (links preview bare in WhatsApp/iMessage); share links point to the home page, no `?ref=` | index.html, tide.js |

## One distinctive twist per game (from the specialists)
- **Tidepop (match-3):** tides that change gravity direction; ghost race of the #1 Daily Dive; 2×2 goal-seeking special; real blockers.
- **Reef Blocks:** race a recorded run on the same seed; trapped reef creatures to rescue; a tide that pushes a coral row every N moves.
- **Chess:** daily ocean puzzles + Puzzle Rush; sea-creature bots with personalities & chat; "Calm Waters" coach mode; Web Worker; post-game review.
- **Ludo:** house-rules sheet (capture-to-enter-home, Joda blocks, quick start); Team Up 2v2; emoji reactions; bot difficulty & fast bots.
- **Cube Twist:** seeded daily scramble (moves + time); "par golf" fewest-moves; free solve with timer/ao5; standard notation.
- **Tide of the Day:** spoiler-free share; true "perfect" target 💎; archive & hard mode.
- **Deep Miner:** cargo cap / push-your-luck; sonar route-planning; dig feel.
- **Puffer Dash:** hold to inflate (two physics on one button); instant retry; ghost of best run.
- **Sea Serpent:** ghost serpents from top replays; smooth tube body; boost.
- **Shell Merge:** creatures with abilities; next-tile preview; merge juice.
- **Reef Tower:** zones change the rules (currents, wind); ripple/shake juice.
- **Sort Splash:** hold the solved board; hint for O₂; lift the whole run.
- **Coral Breaker:** BBTAN-style creeping wall + multiball; aim line.
- **Crab Catch:** spawns on a beat grid (rhythm), daily "song"; fever mode; audible misses.
- **Creator Studio:** remix with credit; weekly theme jam; featured shelf; fair ratings.

## Critic's cut / keep / double-down
- **Cut:** Puffer Dash, Sea Serpent, Reef Tower, Crab Catch, Coral Breaker, Cube Twist.
- **Merge:** Shell Merge & Sort Splash into puzzle modes; Tide Pool + Vibes into one cozy layer.
- **Keep:** Chess & Ludo for friends (pass & play, online codes); Deep Miner (most original).
- **Double down:** Tidepop match-3 + Tide of the Day as the flagship daily ritual.
(Other reviewers would rather fix than cut – e.g. specialists see clear hooks for Puffer, Serpent, Catch.)

## Growth & monetisation
- First 10k players: the daily share loop (fix spoiler, deep-link, `?ref=`), CrazyGames with one hero game, r/WebGames/itch.io/Show HN, Play Store via TWA (needs a custom domain). Skip paid UA until D7 is known.
- Ads: rewarded, opt-in, per view (double chest, unranked continues); interstitials only between endless runs after first sessions. **Never** on ranked dailies, streaks/freezes, challenge landings, Creator Studio, cozy/night mode, or under-13s (contextual only). H5 Games Ads is invite-only; AppLixir needs ~5k DAU.
- Launch blockers: analytics (cookieless, retention + share funnel), age gate + Google-certified CMP (EEA/UK), privacy policy/terms, custom domain + ads.txt, OG preview image, manifest `id`/screenshots.

## Live-ops (90 days)
Rotating mission pool (~12 templates + weekly tier); free **Tide Pass** seasons (XP from any game, cosmetic rewards, no paid track); shell sinks that scale (second cove area, Pip outfits, more comfort stars); weekly **leagues of ~30** instead of global top-10 prizes; a cross-game **sticker album**. Season 1 "Winter Lights" (advent doors Dec 1–24, Longest Night lantern goal Dec 21, "my year in tides" Dec 31), Season 2 "Abyss" with a Creator Jam, Lunar New Year lanterns, Valentine's "pen-pal week".

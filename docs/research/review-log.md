# Review log

Process: implement panel findings one by one → re-review with the same panel → note verdicts → repeat until every reviewer says "yes, this is a platform I'd play".

## Round 1 (Nov 2026) – baseline
Critic 5/10. Full findings: `panel-review-2026-11.md`.

### Work items (status)
| # | Item | From | Status |
|---|---|---|---|
| 1 | Tide: spoiler-free share (per-move flood squares), beam-search perfect/par, limit = perfect+3 (careful 93% / sloppy 66% win), 💎 perfect, deep link `?tide=N&ref=share` | daily-puzzle gamer, growth | ✅ |
| 2 | Hub v2: games on the first screen (6 visible on iPhone 13), compact header, flagship order, meaningful tags (🔥 2× today / ✓ today / New), Hot card removed (redundant) | critic #1, UX #4/#6 | ✅ |
| 3 | Names: brand = Tidepop; match-3 = **Shell Swap**; home = **Cozy Cove**; "Chess Ladder" → **Chess** | critic #2 | ✅ |
| 4 | A11y: zoom allowed, no aria-live on `<main>` (timer no longer read every second), toasts as polite status, device reduce-motion respected by default, aria-labels on game cards, aria-pressed on vibes, 44px tap targets, readable disabled states, more opaque cozy panels, sticky sheet actions | UX #1,2,3,7,9,10 | ✅ |
| 5 | First-time rules wall → one in-game tip toast (How to play still in the menu) | UX #5 | ✅ |
| 6 | Docs & store: README game count/names/name rules fixed, manifest id + description (no "ad-free", no "kids" category), OG/Twitter preview tags, "ad-free" removed from the match-3 home | critic #8, growth #4/#5 | ✅ |
| 7 | Cube Twist: fast swipes during a turn now turn layers (kept hit areas), free undo, live timer + moves, standard notation (R U F … M E S), late allowance floor 70, a run = 20 cubes (finish bonus), **Free solve** 3×3/2×2 with scramble shown, best/ao5/ao12 | speedcuber, critic #5 | ✅ |
| 8 | Chess: bot thinks in a Web Worker (longest frame gap 29 ms vs ~1.9 s freeze), honest strength labels (~400 → ~1500), six sea-creature personalities with style (Octopus loves knights, Shark attacks the king, Turtle castles early) and chat lines, **Daily puzzle** (same for everyone, generated deterministically: 20/20 seeds, ~45% mates, 35% multi-move) + **Practice puzzles** with rating, streak and misses | chess gamer #1/#2/#5, critic #4 | ✅ |
| 9 | Ludo: house-rules sheet (capture-before-home, Joda blocks, quick start) remembered per family; **Team Up 2v2** (partners never capture each other, team win screen); bot difficulty Easy/Normal/Hard; fast bots; emoji reactions (😊 button + bots react to captures/sixes). 3,600-game rule checks: 0 violations | ludo gamer #1–#4 | ✅ (online dice commit–reveal: open) |
| 10 | Shell Swap (match-3): swipes accepted mid-cascade (animation fast-forwards), **Starfish** special from 2×2 squares (clears a plus, swims to an algae/crate goal; combos carry line/bomb to the target; ~4.6 per game), levels re-balanced by the bot balancer, Hard/Super-hard labels, win-streak rewards (3/5/10), creatures fly to the goal counter, weightier clears; ENGINE_VERSION 2 | match-3 gamer #1/#2/#4/#5 | ✅ (trapping gravity & non-square boards: open) |
| 11 | Reef Blocks: fair trays (some order of the 3 pieces always fits; crowded boards get a line-finisher) – impossible trays 4.0% → 0%; snap to nearest legal spot; red ghost on illegal spots; rejected pieces slide back; combo meter (placements left); Good/Great/Amazing/Unreal callouts; shake on multi-line; perfect-clear burst; danger glow when nearly full; ENGINE_VERSION 3 | block-puzzle gamer #1/#2/#3/#5 | ✅ (adventure/rescue mode, ghost race: open) |
| 12 | Crab Catch: burrows pop on a beat grid (120→150 BPM), on-beat catches +5 ♪, ×5 combo lights a 5 s **FEVER** (double points, no jellies), escapes are audible and visible ("Escaped!" puff) | arcade gamer, critic #3 | ✅ |
| 13 | Sort Splash: solved puzzle held 0.9 s with tubes flashing green; 💡 hint for 3 O₂ (logged, replay-verified); the whole same-colour run lifts when selected | arcade gamer, critic #3 | ✅ |
| 14 | Reef Tower: near-perfect (≤3) **snaps** on with no slice (no streak); zones that change the rules – 🌊 currents (surge, seed-phased), 🌬️ wind (fast one way, slow the other), ✨ stars; ripple + camera bounce on perfects, shake on a miss; dashed **best-height** line; game over in 450 ms (was 1.1 s) | arcade gamer | ✅ |
| 15 | Coral Breaker: **multiball** (M) and **sticky clam** (S: catch, aim by position, fire); chain bonus with rising pitch; pearl trail; dotted **aim line**; coral **creeps down** a row every 30 s; game over in 0.5 s | arcade gamer | ✅ |
| 16 | Puffer Dash: swaying gaps after 20 corals, golden **squeeze** gaps (double) after 40; **ghost** of your best run on the same seed; game over in 450 ms (Enter/Space = Play again) | arcade gamer, critic #3 | ✅ (hold-to-inflate: open) |
| 17 | Sea Serpent: smooth gliding **tube body** (interpolated between cells); **Dash** spends a segment for 2 s of double speed, +10 per shrimp while dashing (logged, replay-verified) | arcade gamer, critic #3 | ✅ (ghost serpents: open) |
| 18 | Shell Merge: "+value" popups and sparkles; multi-merge **combo bonus** (+25% per extra merge); **Next** creature preview; **earned undo** (each new top tile ≥128, hold 2) | arcade gamer | ✅ (creature abilities: open) |
| 19 | Deep Miner: **cargo bag** (300, ore past the cap is lost) banked at shop ledges/surface; shop sells bigger bag and 📡 **sonar** (ores glow through the dark for 40 turns); dig cracks, weight by hardness; ENGINE_VERSION 4 | arcade gamer, critic (keep) | ✅ |
| 20 | Live-ops: **12 rotating daily missions** (1 easy + 2 others, same for everyone) + a **weekly tier** with its own chest; free **Tide Pass** seasons (30 tiers, XP from any game/chests/Tide, no paid track, season outfit at tier 30); **sticker album** (42 stickers on 4 pages – game stickers by playing, sea life from packs, spares → shells, page bonuses); **Pip's wardrobe** (7 outfits 250–4,000 🐚 + one per season) as a shell sink that scales | live-ops #1–#4, critic (economy) | ✅ |
| 21 | **Weekly leagues** of up to 30 per division (🥉→💎): +10 per verified run (30/day), +20 for a new personal best; top 5 promote, bottom 5 drop; 🐚 400/300/200 for the podium; works on the server and the claude.ai shared db | live-ops (leagues instead of global top-10) | ✅ |
| 22 | Creator Studio: ratings only from players who played and aren't the creator; reports need a play, count per version and **hold** a game for review (creator is told; a fixed version starts fresh); moderator clear/remove; **remix with credit**; weekly **jam** theme + shelf; **featured** shelf | creator gamer #1–#4, bug list | ✅ |
| 23 | Online Ludo: the **server rolls each die** when the roll is posted (crypto RNG) – no predicting rolls from the shared seed; both clients rebuild from the same dice (tested over a full game) | ludo gamer, bug list | ✅ (claude.ai shared-db mode still seeded) |
| 24 | Shell Swap: **crates trap** – new gems don't drop through crates; gaps under them fill by diagonal slides; levels re-balanced; ENGINE_VERSION 5 | match-3 gamer, bug list | ✅ |
| 25 | Launch basics: **privacy & terms** page, **age band** (under 13: random names, no publishing/accounts, contextual-only ads if ever), **cookieless anonymous counts** (open/retention bucket, game, share, ref; opt-out; team-only read), **1200×630 link preview**; iOS pinch-zoom no longer blocked | growth launch blockers, UX | ✅ |
| 26 | Name filter: separate numbers aren't leetspeak any more ("Kind Fish 17" was rejected); 20,000 random nicknames verified clean | found while testing | ✅ |

## Round 2 (Nov 2026) – re-review by the same panel
Verdicts as they arrive (score /10, Round 1 → Round 2). 9 of 13 reviews were interrupted by a usage limit and resumed.

| Reviewer | Verdict | Score | Still blocking (their top items) |
|---|---|---|---|
| Arcade A (Miner, Puffer, Serpent, Merge) | NOT YET | 5 → 6.5 | Puffer ghost rarely shows (random seeds); hold-to-inflate; serpent ghosts; miner cargo isn't push-your-luck; merge creature abilities |
| Speedcuber (Cube Twist) | NOT YET | 5 → 6.5 | keys not view-relative / no csTimer layout; no shared daily scramble; no inspection/+2/DNF/session; scrambles without doubles; pause didn't stop timer |
| Live-ops | NOT YET | 5 → 7 | pass finishes in ~19 days; shells run dry ~day 28; seasons are only a name; Open Sea repeats the same outfit; solo-league 400 🐚 exploit; old top-10 prizes doubling |
| Growth | NOT YET | 5 → 7 | relative og:image; share funnel unmeasurable; retention in 24 h blocks; (business: GDPR controller/contact, domain, ads.txt, CMP) |
| Critic, UX, match-3, block puzzle, chess, ludo, daily puzzle, arcade B, creator | pending | | |

### Round 2 work items
| # | Item | From | Status |
|---|---|---|---|
| 27 | Puffer **hold to inflate** (bigger, floaty, replay-verified); Puffer & Serpent endless runs use a **course of the week** so ghosts race you; **Serpent ghost**; Serpent "grow to 5 to dash" hint; modal ignores keys mashed in the first 250 ms | arcade A | ✅ |
| 28 | Deep Miner **push-your-luck**: stranded = drop half the unbanked bag, lava burns a quarter, cash out keeps it all | arcade A | ✅ |
| 29 | Shell Merge **creature powers**: 🐙 128 inks the smallest neighbour, 🦈 256 eats neighbouring 🐚 2s | arcade A | ✅ |
| 30 | Cube: **view-relative keys** + **csTimer layout** (M, y), **WCA-style scrambles with half turns** (R2 shown), optional **15 s inspection** (+2/DNF), session with **+2/DNF/delete**, WCA ao5/ao12, Stop = DNF, **pause stops the timer**, final time stays on screen, **Daily Scramble** (same for everyone, fewest moves, replay-verified, one try) | speedcuber | ✅ (time leaderboard not verifiable by replay – moves board only) |
| 31 | Tide Pass paced to ~60 days for a regular player (400 XP/tier) + **repeatable bonus tiers**; **seasonal decor shop** (~3,800 🐚 each season) and **limited sticker page** per season; **Winter Lights advent doors** (Dec 1–24, Longest Night lantern on Dec 21); Open Sea outfit rotates (already owned → 500 🐚); league podium only in leagues of 10+; old global top-10 prizes retired | live-ops | ✅ (shared-db league points are client-written – server mode is authoritative) |
| 32 | Share funnel: `ref=` on every share link, shares counted only when sent, ref split new/returning (once per session), `onboard` event; **calendar-day** retention with one event per D1/D7/D30 milestone; absolute og:url/og:image/twitter:image; robots.txt | growth | ✅ (GDPR controller/contact, domain, ads.txt, CMP: business tasks) |

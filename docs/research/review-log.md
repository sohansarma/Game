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
| Creator Studio | NOT YET | 5 → 6 | registration race silently broke ratings/reports; remix credit & jam not checked by the server; "played" was a ping; no moderator queue |
| Block puzzle (Reef Blocks) | NOT YET | 5 → 6.5 | no rescue/adventure mode; no ghost race; endless never gets harder; combo meter clipped |
| Match-3 (Shell Swap) | NOT YET | 5 → 6 | full-row crate walls still refilled; mid-cascade swipes hit the wrong gem; early levels luck-driven; 2×2 special untaught; no signature twist |
| Ludo | NOT YET | 5 → 7 | online without house rules/Team Up; reactions local only; no partner badge; finished partner sits out; some dice seeded |
| Daily puzzle (Tide) | NOT YET | 5 → 7 | no archive; nothing after 💎; share text unreadable without the app; UTC reset |
| UX & accessibility | NOT YET | 5 → 7 | modals don't trap focus; low contrast on the bright sea; clipping at 200% text; focus lost on screen changes; album/pass not readable by screen readers |
| Arcade B (Tower, Sort, Breaker, Catch) | NOT YET | 5 → 7 | fever only once per streak; no audible beat; creeping wall can't reach you; slow endings; vertical ball loop |
| Critic | NOT YET | 5 → 6.5 | no focus (13 equal cards); match-3 generic and easy; Tide shallow (no archive/hard mode); celebration blocks & can lose a win; pop-up on return |
| Chess | NOT YET | 5 → 6 | **taps missed the squares until a resize**; no review; no premoves; weak puzzles; hint froze the screen; Kraken up to 11 s |

Round 2 average: **6.6/10** (Round 1: 5). Nobody said YES yet – every reviewer's blockers are worked through below and go back to the same panel in Round 3.

### Round 2 work items
| # | Item | From | Status |
|---|---|---|---|
| 27 | Puffer **hold to inflate** (bigger, floaty, replay-verified); Puffer & Serpent endless runs use a **course of the week** so ghosts race you; **Serpent ghost**; Serpent "grow to 5 to dash" hint; modal ignores keys mashed in the first 250 ms | arcade A | ✅ |
| 28 | Deep Miner **push-your-luck**: stranded = drop half the unbanked bag, lava burns a quarter, cash out keeps it all | arcade A | ✅ |
| 29 | Shell Merge **creature powers**: 🐙 128 inks the smallest neighbour, 🦈 256 eats neighbouring 🐚 2s | arcade A | ✅ |
| 30 | Cube: **view-relative keys** + **csTimer layout** (M, y), **WCA-style scrambles with half turns** (R2 shown), optional **15 s inspection** (+2/DNF), session with **+2/DNF/delete**, WCA ao5/ao12, Stop = DNF, **pause stops the timer**, final time stays on screen, **Daily Scramble** (same for everyone, fewest moves, replay-verified, one try) | speedcuber | ✅ (time leaderboard not verifiable by replay – moves board only) |
| 31 | Tide Pass paced to ~60 days for a regular player (400 XP/tier) + **repeatable bonus tiers**; **seasonal decor shop** (~3,800 🐚 each season) and **limited sticker page** per season; **Winter Lights advent doors** (Dec 1–24, Longest Night lantern on Dec 21); Open Sea outfit rotates (already owned → 500 🐚); league podium only in leagues of 10+; old global top-10 prizes retired | live-ops | ✅ (shared-db league points are client-written – server mode is authoritative) |
| 32 | Share funnel: `ref=` on every share link, shares counted only when sent, ref split new/returning (once per session), `onboard` event; **calendar-day** retention with one event per D1/D7/D30 milestone; absolute og:url/og:image/twitter:image; robots.txt | growth | ✅ (GDPR controller/contact, domain, ads.txt, CMP: business tasks) |
| 33 | Creator Studio: one registration at a time (parallel calls minted two ids – ratings/reports failed silently); rate/report needs a **server-replayed play**; server writes remix credit from the original and only takes this week's jam; remix counts; creator **appeals**; **moderator queue** (server ADMIN_KEY list; claude.ai owner gets a Held tab); failures shown; tabs wrap | creator | ✅ |
| 34 | Accessibility: modals **trap focus**, the page behind is **inert**, dialogs named by their heading, inputs focused first; screens move focus to their heading and **Back returns focus** to the card; readable timer/intro/locked text; topbar wraps at large text; album & Tide Pass have list semantics with names and states; reduce-motion follows the device until you choose; tag contrast | UX | ✅ |
| 35 | Critic: hub shows **Tide + Shell Swap + 5 favourites** (hot game always visible), the rest under **More games**; "New" only after you've explored; daily treasure no longer blocks the return visit; Shell Swap wins **saved the moment they happen**, tap skips the celebration; stars always 3 slots with a label; zero scores not ranked | critic | ✅ |
| 36 | Chess: every game view re-measures on layout changes (**taps missed until a resize**); **post-game review** (??/?/?!/★, better move, accuracy, key moment); **premoves**; hint in the worker; bot search capped at **2.5 s**; puzzles skip recaptures and prefer 2+-move combinations, Elo-style rating by difficulty, answer in notation with an arrow, next puzzle prefetched | chess | ✅ |
| 37 | Arcade B: Crab Catch **fever every 12 in a row**, **audible beat**, ♪ bonus only on the click; Coral Breaker **aimed serve**, the coral **can reach you** (−1 pearl), last-bricks drift, no vertical loop; Tower popups not overwritten; Sort hint in How to play; Puffer shows hold + weekly ghost | arcade B, critic | ✅ |
| 38 | Tide: **archive** (last 2 weeks, practice) and `?tide=N` opens that day; **Hard tide** (fresh board, limit = perfect) after you solve; share text has a one-line key; reset shown in **local time**; 💎 on the hub card | daily puzzle, critic | ✅ (days still change at UTC midnight) |
| 39 | Reef Blocks: **Rescue mode** – 20 levels freeing trapped fish within a piece budget, the **tide** pushes rows up from level 5, seeds picked for a 95%→45% curve; **Daily ghost race** vs today's #1 (server keeps the log); endless gets tougher (fewer small pieces after 200, the kind dealer fades, combo cap x8); undo offered before game over; combo meter visible; bigger tray pieces; ENGINE_VERSION 6 | block puzzle | ✅ |
| 40 | Shell Swap: **Tide levels** (every third level from 12: a wave sweeps the bottom row every 5 moves and fires specials – HUD counter + level card); crate walls leave a feed gap; 5 colours from level 4; collect goals grow until a level needs real moves; tougher crates/algae from 12; **Wish Star** taught (level 5 + How to play); **Daily Dive ghost race**; mid-cascade swipes grab the gem drawn under your finger; callouts stack; taps/keys work mid-cascade; "So close" only when close; levels re-balanced | match-3, critic | ✅ (levels 6 & 12 still quick with the hint bot) |
| 41 | Ludo: **house rules and Team Up online** (you + friend vs 2 bots); **reactions reach the other phone**; 🤝 partner badge; a **finished teammate's turns go to their partner**; Team Up start button explains it fills the table | ludo | ✅ (3–4 humans online and server dice for online bots: open) |

## Round 3 – re-review
| Reviewer | Verdict | Score (R1 → R2 → R3) | Remaining (their words, short) |
|---|---|---|---|
| Growth & monetisation | **YES** | 5 → 7 → 8 | one canonical production origin; persistent disk; privacy contact details; CMP/ads.txt (business) |
| UX & accessibility | **YES** | 5 → 7 → 8 | reduce-motion re-read at start; timer pill at 200%; name dialog heading |
| Daily puzzle (Tide) | **YES** | 5 → 7 → 8 | reload restarts a ranked tide; late links land in practice; hard share weaker; hard HUD par |
| Arcade B | **YES** | 5 → 7 → 8 | Breaker tap serve ≠ aim line; creep has no teeth; stale "tap to launch" text |
| Reef Blocks | **YES** | 5 → 6.5 → 8 | Rescue undo overwrote Endless run; toasts over the board; empty ghost box |
| Arcade A | **YES** | 5 → 6.5 → 7.5 | ghosts only your own; serpent ghost faint; merge popups pile; 250 ms guard short |
| Creator Studio | **YES** | 5 → 6 → 8 | throwaway reports; no admin UI in server mode; studio list lacks "held"; played() failure silent |
| Live-ops | NOT YET | 5 → 7 → 8 | shells pile up after ~day 32 (needs a repeatable sink); snorkel unearnable; Open Sea has no decor |
| Speedcuber | NOT YET | 5 → 6.5 → 7.5 | daily scramble won by its inverse (and QTM); one try not enforced; no wide/x/z keys; delete crash |
| Chess | NOT YET | 5 → 6 → 7.5 | review engine too shallow (Opera Game); no board in review; daily puzzle a mate-in-one |
| Ludo | NOT YET | 5 → 7 → 8 | no 3–4 humans online / partner choice; guest not told the rules; online bot dice seeded; background move flush |
| Critic | NOT YET | 5 → 6.5 → 7 | **Shell Swap render loop could freeze**; difficulty flat; 11 s celebration; toasts over result card |
| Match-3 | NOT YET | 5 → 6 → 7 | Wish Star didn't seek goals; tutorial too hard / tide skippable; in-place spawns under walls; server out of date; Wish Star hard to see |

Round 3: **7 of 13 YES**, average **7.8/10**.

### Round 3 work items
| # | Item | From | Status |
|---|---|---|---|
| 42 | Shell Swap **render loop can't freeze** (effects clamped, loop guarded and keeps running); celebration at triple speed; **toasts queue** (max two) | critic | ✅ |
| 43 | Shell Swap: **pockets under crates stay empty** until the crate breaks (real trapping); hole-blocked crate rows get a gap; **Wish Star swims to goal creatures**; magenta star with a dark halo; tutorial ≈ unlosable; boss levels tuned to the hint player, tide levels from 9, moves floor 7; a failed star submit is shown; ENGINE_VERSION 8 | match-3, critic | ✅ |
| 44 | Live-ops: **repeatable shell sinks** (polish cove pieces ★★★ → up to 8-star comfort; sticker packs for 300 🐚); chest shells trimmed; First Tide keeps the old pace (snorkel earnable); Open Sea reuses seasonal decor/stickers; spare seasonal stickers pay by rarity | live-ops | ✅ |
| 45 | Cube: Daily Scramble **hides the move list**, counts **face turns** (R2 = 1), **reversed scramble scores 0**, counts as used at start; csTimer wide moves (r/l), **x/y/z rotations**; moves list shows what you pressed; inspection pauses; Stop freezes the clock; delete-only-solve crash fixed; ENGINE_VERSION 7 | speedcuber | ✅ |
| 46 | Chess: review = **one depth-3 search per position + a deeper look at the played move** (Opera Game: Morphy's sacrifices pass, 15…Nxd7 is the ??); **board in the review**; returns to the result (rematch kept); **daily puzzle always a combination** | chess | ✅ |
| 47 | Ludo: **2–4 people online on one code** (partner opposite = first to join), rules & Team Up in the create sheet, **guests shown the house rules**, reactions from every seat, move flushed when the phone goes to the background | ludo | ✅ (online bot dice still seeded) |
| 48 | Tide: an unfinished ranked/hard tide **resumes** (a reload isn't a second try); practice offers today's tide; hard share uses the full share text; hard HUD hides par | daily puzzle | ✅ |
| 49 | Reef Blocks: Rescue undo no longer overwrites Endless; Rescue callouts on the board; empty ghost box hidden | blocks | ✅ |
| 50 | Breaker tap serves along the drawn line, paddle stays while aiming, coral creeps every 20 s, serve text; Merge popups capped; modal key guard 450 ms; zero runs never become ghosts | arcade A/B | ✅ |
| 51 | Accessibility: reduce-motion re-read every start; welcome dialog heading; timer wraps at 200% | UX | ✅ |
| 52 | Creator: a vote needs a ≥10 s play; play report retries; privacy page gets a controller & rights section (fill-ins for operator/contact/hosting) | creator, growth | ✅ |

## Round 4 – re-review of the six NOT-YET reviewers
| Reviewer | Verdict | Score (R1 → R2 → R3 → R4) | Follow-ups (not blocking) |
|---|---|---|---|
| Live-ops | **YES** | 5 → 7 → 8 → 8.5 | late-joiner "needs ~330 XP/day" on First Tide; sink for heavy players after the album |
| Match-3 | **YES** | 5 → 6 → 7 → 8 | levels 1–3 still losable by casual play; level 6 spike (7 moves); tide skippable on 12/24/39 |
| Speedcuber | **YES** | 5 → 6.5 → 7.5 → 8 | reversed-scramble check beatable by reordering commuting moves |
| Critic | **YES** | 5 → 6.5 → 7 → 8 | cap untapped celebration at 3 s; clamp flash radius; Hard/Super hard labels overstate |
| Ludo | **YES** | 5 → 7 → 8 → 9 | a player who leaves freezes a 3–4 person table (needs bot takeover); stale "2 players" text |
| Chess | **YES** | 5 → 6 → 7.5 → 8 | first daily puzzle takes ~30 s to generate on-device (precompute/prefetch) |

Round 4: all six former NOT-YET reviewers now say YES; with the seven Round 3 YES votes that is **13 of 13**, average ≈ 8.2/10.

### Round 4 polish (engine v9) – done before the full 13-reviewer Round 5
| # | Item | From | Status |
|---|---|---|---|
| 53 | Ludo: a player who leaves a 3–4 person table is replaced by a **bot after ~50 s** (server `botify`, `botFrom` per seat, identical on every phone); "Waiting for X…" hint; table label/`describe()` say the real player count | ludo | ✅ |
| 54 | Shell Swap: win celebration capped at ~3 s; flash radius clamped; tides every 4 moves (always shows); levels 1–3 forgiving; teaching levels ≥10 moves | critic, match-3 | ✅ |
| 55 | Cube: reversed-scramble check ignores the order of commuting moves (L R = R L) | speedcuber | ✅ |
| 56 | Chess: today's daily puzzle is warmed in a background worker 8 s after launch | chess | ✅ |

### Round 5 – full 13-reviewer re-review (in progress)
| Reviewer | Verdict | Score | Notes |
|---|---|---|---|
| Growth | YES | 8 | launch items only: production origin in OG tags, persistent disk, ads/CMP |
| Live-ops | YES | 8.5 | no live-ops code changed |
| Match-3 | YES | 8 | tide still skipped on 12/24 in 2 of 6 hint runs; tutorial a little gentler |
| Creator | YES | 8 | **idle runs still earned a vote** → fixed (57) |
| Arcade B | YES | 8.5 | breaker help text said 30 s → 20 s |
| Speedcuber | YES | 8 | a cube rotation still hides the reversed scramble (needs state comparison) |
| UX | YES | 8.5 | hub timer pill overflowed at 200% text → wraps (58) |
| Reef Blocks | YES | 8.5 | rescue short; popups overlap |
| Arcade A | YES | 8 | ghosts only local for Puffer/Serpent |

| # | Item | From | Status |
|---|---|---|---|
| 57 | A rating/report vote needs a real play: ≥10 s, ≥3 inputs and a score > 0; held games show "⏸ Under review" in lists; breaker help says 20 s | creator, arcade B | ✅ |
| 58 | Hub header wraps at large text | UX | ✅ |

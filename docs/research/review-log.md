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

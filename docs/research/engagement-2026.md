# Engagement research & brainstorm (Nov 2026)

Two research passes: web research on retention mechanics in top casual games, and a codebase-grounded brainstorm of Tidepop's current loop. Goal: players return daily and feel cozy, without dark patterns (all-ages audience, many play at night).

> Caveat: most figures come from search results and studio/vendor publications (some pages could not be fetched directly); many are correlational. Treat as signals and A/B-test.

## Benchmarks
- Median mobile game (GameAnalytics Q1 2024): D1 22.9%, D7 4.2%, D28 0.85%; puzzle has the highest D7. https://gamedevreports.substack.com/p/gameanalytics-benchmarks-in-mobile
- Royal Match ≈ 45% D1 / 22% D7 / 14–16% D30. https://www.pocketgamer.biz/dream-games-royal-match-leads-match-3-d30-retention-at-165
- Block Blast D1 26.7% / D7 13.4% / D30 7.1%. https://maf.ad/en/blog/block-blast/

## What works (ranked for Tidepop)
1. **Finite daily ritual + shareable result** (Wordle/NYT): one shared puzzle a day, emoji result grid. https://techcrunch.com/?p=2311910
2. **Forgiving streaks** (Duolingo): low bar, freezes, repair. Making one lesson enough lifted 7+ day streaks >40%; streak wager +14% D7. https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals — *shipped: streak freezes + welcome-back gift.*
3. **Come back tomorrow, not "one more"** (Animal Crossing real-time, Pokémon Sleep, capped offline rewards). https://corporate.pokemon.co.jp/en/topics/detail/110.html — *shipped: sleep timer → good-night card with tomorrow's preview; "Tuck in" end-screen option at night.*
4. **Collection album across all games** (Monopoly Go): never sell random packs. https://www.pocketgamer.biz/decoding-the-live-ops-strategy-of-monopoly-go
5. **A personal cozy space** (Animal Crossing, Stardew, Homescapes meta-layer): stress relief is the top cozy-game motive. https://sago.com/en/resources/insights/the-rise-of-cozy-gaming-across-borders/
6. **Async challenge links + friend boards**: MobilityWare Solitaire challenges +4% DAU, +1–3% D1–D28. https://www.casestudies.com/company/flurry/case-study/how-mobilityware-used-flurry-to-boost-active-solitaire-users
7. **Weekly leagues/divisions** (~30 players, opt-in). https://blog.duolingo.com/improving-duolingo-one-experiment-at-a-time
8. **Win-streak momentum** that steps down (not wipes) on a loss. https://www.liquidandgrit.com/resource/eight-top-puzzle-apps-use-nearly-identical-win-streak-mechanics-casual-report/
9. **Daily missions spread across games**, chest contents shown up front.
10. **Gentle seasonal events** whose items return later (no FOMO). https://sensortower.com/blog/what-royal-matchs-calendar-teaches-about-live-ops-in-2026
11. **Family/friend co-op goals** (pass & play counts).
12. **Bedtime wind-down**: 150 min of pre-sleep gaming hurt sleep efficiency, 50 min did not. https://flore.unifi.it/retrieve/d7ba7cf8-0cd8-4dab-be1c-6c805e2deb96/De%20Rosa%20et%20al.%2C%202025.pdf

## Gaps in the current loop (from the code)
- Shells only buy match-3 boosters: no meta-progression across the 13 games (biggest gap → Tide Pool home / album).
- Streak reset after one missed day (fixed: freezes + welcome back).
- Two day clocks: treasure uses local day, missions/dailies UTC; the red "last hour" countdown can land at night (fixed in cozy mode at night).
- First session is a choice wall of 13 cards → guided starter game + starter missions.
- Social is one-shot (challenge links) → saved "pen pal" rivals and a friends board.

## Ads without hurting retention
- Rewarded, opt-in ads only for extras (continues, chest doubling); never gate the daily ritual or streak freezes. Ad-exposure studies show little retention impact, likely selection bias. https://businessofapps.com/?p=56912
- No interstitials in first sessions, only at natural breaks, frequency-capped, **none in cozy/night mode**. Early interstitials lowered rewarded-ad use and 14-day LTV. https://airflux.ai/blog/interstitial-ads-monetization
- Contextual ads only for children (COPPA).

## Avoid (ethics & regulation)
- Paid/random loot boxes and packs (FTC × HoYoverse $20M, Jan 2025; EU Digital Fairness Act proposal). https://ftc.gov/business-guidance/blog/2025/01/level-tips-businesses-ftcs-settlement-genshin-impact-developer-hoyoverse
- Selling currency in ways that push overspending (EU CPC principles 2025). https://www.twobirds.com/en/insights/2025/european-move-towards-protecting-users-from-harmful-practices-in-video-games-eu-consumer-protection
- Fake timers, guilt-trip "No thanks" copy, night-time notifications, energy systems gated by ads, rewarding late-night play, endless auto-continue. Let players switch streaks off.

## Recommended next builds
1. **Tide Pool home** (decorate with shells from any game; Pip lives there; glows in cozy mode) — the missing spine; later carries seasons, album, gifting.
2. **Tide of the Day**: one shared seeded puzzle across the 13 games with a shareable emoji grid.
3. **Night tidepool**: plant before sleep, blooms (chest) next morning — rewards stopping, not staying up.
4. **Sea-creature sticker album** earned per game (never sold).
5. **Guided first five minutes** + starter missions.

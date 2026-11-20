# Play Store checklist – mixed audience, rewarded ads

Tidepop is **for everyone, not child-directed**. The code enforces one rule everywhere: **under 13 – and anyone who hasn't answered the age question – is a child** (`public/js/policy.js`).

> Google's policies change. The answers below describe what the code does; **check each form against the current Play Console help text before you submit**, and ask a lawyer to review the privacy page (it still has `[to be completed]` placeholders for the operator, contact email and hosting region).

## What the app does, by audience

| | Under 13 / unanswered | 13 and older |
|---|---|---|
| Accounts, Google sign-in, custom names, publishing | No | Yes |
| Ads | Rewarded only, child-directed, rating G, **non-personalised, no advertising ID** | Rewarded only, rating PG; Google's consent form first; personalised only if they agree |
| Analytics | Anonymous totals only, **no install id** | Random on-device install id (deleted when they switch counts off) |
| Ads before the age question | Never | Never |

Rewarded-ad spots: **bonus shells** after an arcade game, and **revive** (once per run) in Reef Blocks and Shell Merge when the run ends. A revive is a logged action the server replays, so scores stay verified. It is **off in the Daily challenges and friend challenges**, because those are the same ad-free run for everyone. The server cannot tell whether an ad was actually watched, so a modified client could revive once per all-time run without one; that is the accepted limit.

## Play Console – Target audience and content

- **Target age groups:** pick the groups you actually want. Choosing any group under 13 puts the app under Play's *Families* policy. Because the game appeals to both, the intended setup is a **mixed audience**: children *and* adults, with a neutral age screen. Confirm in Play Console help which options apply to a mixed-audience app.
- **Neutral age screen:** `askAge()` in `main.js` – "How old are you?", two equal buttons, no hint that one answer unlocks more, no birthday stored.
- **Ad networks:** use **AdMob only** until you have checked every other network against Google's Families-certified list. Do not add mediation partners that aren't certified – they would also serve children.
- **Content rating questionnaire:** no violence, no gambling, no user-generated *chat*. Community games (Creator Studio) are user-generated content with reporting and moderation – answer that question accordingly.

## Data safety form (what the app collects)

| Data | Collected? | Notes |
|---|---|---|
| Device or other IDs | **Yes** (adults) | Advertising ID via AdMob, only for adults who agree; random install id for usage counts (adults, can be switched off) |
| App activity / interactions | Yes | Anonymous events (games started/ended, funnel steps) |
| Crash logs / diagnostics | Yes | `err` and `perf` events, no stack traces |
| Personal info: name | Optional | Player-chosen display name (shown on leaderboards); under-13s get a random one |
| Personal info: email | **No** | Google sign-in sends only a Google account id; email/name/picture are ignored |
| Location, contacts, photos, files, audio | No | |
| Purchases / financial | No | Nothing is for sale |

- **Shared with third parties:** Google (AdMob, and Google sign-in if used).
- **Encrypted in transit:** yes (HTTPS). **Deletion:** in-app (Settings → delete account, delete online scores, switch off usage counts) – state this in the form and give the privacy page URL.

## Before you submit

- [ ] Fill the privacy page placeholders (operator, contact, hosting) and host it at a public URL; paste that URL into Play Console.
- [ ] Set `GOOGLE_CLIENT_IDS` and `ADMIN_KEY` on the server; mount a persistent disk at `DATA_DIR` (see `render.yaml`).
- [ ] Follow `android-app/README.md`, including its "test on a real device" list (child path, adult path with the EEA consent form, reward, Google sign-in).
- [ ] Release build uses **your own** AdMob rewarded unit and `ADMOB_TESTING=false`; never tap your own live ads.
- [ ] Declare the **AD_ID** permission use in the Play Console "Advertising ID" question (ads: yes).
- [ ] Add `app-ads.txt` on your developer website so AdMob can verify the app.
- [ ] Provide Google Play test credentials only if reviewers need to sign in (username/password accounts work without any).

## Ready-made pieces (already in the repo)

| What | Where |
|---|---|
| Android project (Capacitor 8, AdMob + Google sign-in plugins, icons, splash) | `android-app/android/` |
| Cloud build for the APK / signed bundle (no Android Studio needed) | `.github/workflows/android.yml` |
| Rename the package before first upload | `android-app/scripts/set-package.mjs` |
| Store text, icon, feature graphic, 6 screenshots | `store/` |
| Account-deletion page (Play requires a public link) | `public/delete-account.html` |
| `app-ads.txt` for AdMob verification | served at `/app-ads.txt` when `ADMOB_PUBLISHER_ID` is set |
| "What's still missing?" checklist | `npm run preflight` |

## Release in order

1. `npm run preflight` – fix every ❌.
2. Choose the package name: `cd android-app && node scripts/set-package.mjs com.yourdomain.tidepop`, then commit.
3. AdMob: create the app and one **Rewarded** ad unit; set `ADMOB_PUBLISHER_ID` on the server, and `ADMOB_APP_ID` / `ADMOB_REWARDED_ID` as GitHub variables. Link the app to the Play listing once it exists.
4. Google Cloud: create the Web and Android OAuth clients (see `android-app/README.md`); set `GOOGLE_CLIENT_IDS` on the server.
5. GitHub → Actions → **Android app** → *debug*. Install the APK on a phone and run the on-device checks in `android-app/README.md`.
6. Create an upload keystore (`keytool -genkey -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`), keep it and its passwords safe (losing it blocks updates), add the four `ANDROID_*` secrets.
7. Actions → **Android app** → *release*. Download the `.aab`.
8. Play Console: create the app, fill the forms from `store/listing.md` and the tables above, upload the `.aab` to **Internal testing**, add yourself as a tester, test, then move to Production. New personal developer accounts may have to run a closed test with a minimum number of testers for a set period before production access – check the current requirement in Play Console.

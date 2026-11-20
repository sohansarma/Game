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

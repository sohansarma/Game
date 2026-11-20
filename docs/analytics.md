# Analytics – how it works end to end

```
app (analytics.js) ──batched POST /api/events──▶ server (api.js, events.js) ──▶ analytics.db (SQLite, DATA_DIR)
                                                         │                         │
                                                         └─ daily tallies in db.json  └─▶ /admin dashboard (team key)
```

## What is collected

Each event is `{ e: name, b: bucket, n?: number }` plus `aud` (`a` adult / `c` child) and `plat` (`web` / `app`). Adults who left counts on also send an `iid` – a random 32-hex id stored in their browser/app only (never in the save or account). **Children never send or have an `iid`**, and the server drops any `iid` that arrives without `aud: "a"`. No IP address, name, account or advertising id is stored.

| Event | Bucket | Meaning |
|---|---|---|
| `open` | `d0` / `later` | first open vs return |
| `ret` | `d1` / `d7` / `d30` | return milestone |
| `funnel` | `age`, `firstgame`, … | onboarding steps |
| `onboard`, `ref`, `share`, `tide`, `chest`, `signup`, `publish` | – | existing counters |
| `start` / `end` | game id | a game began / finished (`end.n` = seconds played) → finish rate |
| `game` | game id | a verified play was submitted |
| `err` | `js`, `promise`, `api` | crashes and server/network failures (max 5 per session) |
| `perf` | `fast` / `mid` / `slow` | page load time (<1 s, <3 s, slower) |
| `install` | `pwa` | the web app was installed |
| `consent` | `granted` / `denied` / `notrequired` | ad-consent result (adults) |
| `ad` | `offer` → `start` → `done` / `skip` / `nofill` / `fail` | rewarded-ad funnel for the end-of-game bonus; the revive spot has its own buckets with a `-revive` suffix (`offer-revive`, `start-revive`, `done-revive`, …) |
| `link` | `google`, `glink` | Google sign-in / link used |

Nothing is sent until the age question is answered. Events are kept 180 days.

## Reading it

1. Set `ADMIN_KEY` on the server.
2. Open `https://<your-server>/admin`, enter the key. It shows active installs, new installs, **day 1/7/30 retention by first-seen day**, per-game starts, finishes and **finish rate**, funnel steps, ads and consent, errors, load speed, and per-day totals split adults / under-13.
3. Raw access: `GET /api/admin/report?days=30` with header `x-admin-key: <key>`.

Revenue itself comes from the AdMob console; this dashboard shows *behaviour* (offers, completions, effect on retention).

## Privacy controls

- Settings → "Send anonymous usage counts" off: stops events, deletes the local `iid`, and calls `POST /api/events/forget` so the server erases everything stored under it.
- Under-13s are counted in totals only.

## Operating notes

- Detailed analytics needs **Node 22+** (`node:sqlite`). On older Node the server still runs and keeps only the daily tallies.
- `analytics.db` lives next to `db.json` in `DATA_DIR`. **On a host without a persistent disk both reset on every deploy** – see `render.yaml`.
- Adding an event: add its name to `METRIC_EVENTS` in `server/api.js`, call `api.track(name, bucket, n?)` in the client, and (optionally) show it in `server/admin.html`.

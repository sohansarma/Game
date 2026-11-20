// Where the leaderboard API lives.
//  ''                      → same server that serves the game (default, `npm start`)
//  'https://my-api.example' → separate API host (e.g. game on GitHub Pages, API on Render/Fly)
// If the API can't be reached the game still works fully offline with
// local best scores, and queued submissions are sent when it comes back.
window.TIDEPOP_API = window.TIDEPOP_API ?? '';

// Rewarded ads in the Android app only (the website never shows ads).
// These are Google's public TEST ids, so a debug build can never produce real
// ad traffic. Before release set testing:false and your own rewarded unit id
// (AdMob console → Apps → Ad units), e.g. in a separate config for the app build.
window.TIDEPOP_ADMOB = window.TIDEPOP_ADMOB ?? { testing: true, rewarded: 'ca-app-pub-3940256099942544/5224354917' };

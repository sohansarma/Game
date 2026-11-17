// Where the leaderboard API lives.
//  ''                      → same server that serves the game (default, `npm start`)
//  'https://my-api.example' → separate API host (e.g. game on GitHub Pages, API on Render/Fly)
// If the API can't be reached the game still works fully offline with
// local best scores, and queued submissions are sent when it comes back.
window.TIDEPOP_API = window.TIDEPOP_API ?? '';

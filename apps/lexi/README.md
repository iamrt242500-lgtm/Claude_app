# Lexi

A daily five-letter word game (Wordle-style). Six tries, green/yellow/grey feedback with correct duplicate-letter handling, on-screen and physical keyboards, shareable emoji result, and stats with streaks.

- The server picks the day's word and scores every guess; the answer is only revealed after a loss, and the word list is never sent to the browser
- Players are identified by an HttpOnly cookie; progress survives reloads
- Only the pure scoring module (`src/game.js`) is shared with the client
- Zero runtime dependencies (Node ≥ 22.13)

```bash
npm start            # http://localhost:3000, DB at ./data/lexi.db (DB_PATH)
npm test             # scoring + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available).

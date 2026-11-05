# Tallyho

Run small tournaments. **Knockout** (2–32 players): standard seeding so the top seeds stay apart, byes for the top seeds when the field isn't a power of two (they advance automatically), winners flow into the next round, no draws, champion at the end. **Round robin**: circle-method fixtures (each pair meets once, each player sits out exactly once when the field is odd), live standings with the tiebreak order *points → head-to-head among the tied teams → goal difference → goals for → entry order*.

- Results can be corrected or cleared; changing the winner of a match whose winner has already played on is refused (HTTP 409) until the later result is cleared
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/tournament.js`

```bash
npm start            # http://localhost:3000, DB at ./data/tallyho.db (DB_PATH)
npm test             # fixtures/seeding/standings + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). No login: anyone with access can edit results.

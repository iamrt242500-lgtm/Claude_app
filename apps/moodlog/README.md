# Moodlog

A private mood and energy journal. Log mood (1–5), energy (1–5), hours slept, tags and a note per day (backfill any past day, never the future). Insights over 7/14/30/90 days: mood line with gaps for unlogged days and a 7-day moving average, sleep↔mood and energy↔mood Pearson correlations in plain language, per-tag "mood with vs without" comparison (only tags with ≥3 days on each side), weekday pattern, and logging streak.

- Honest statistics: correlations are `null` ("not enough data") for n < 3 or zero variance; the UI says correlation is not causation
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/stats.js`

```bash
npm start            # http://localhost:3000, DB at ./data/moodlog.db (DB_PATH)
npm test             # stats + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available).

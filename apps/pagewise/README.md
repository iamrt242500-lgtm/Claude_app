# Pagewise

Reading tracker. Log "I'm on page N" per book per day; pages read are derived from the differences (a lower page is treated as a correction, not negative reading). You get progress bars, a **finish-date estimate** from your last 14 days (days with no reading count as zero), current/longest **reading streak**, a 30-day pages chart, and **yearly goal pacing** (leap-year aware) that says how many books ahead/behind you are.

- A book finishes on the first day a log reaches its last page; deleting that log reopens it
- Total pages can't be set below a page you've already logged
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/reading.js`

```bash
npm start            # http://localhost:3000, DB at ./data/pagewise.db (DB_PATH)
npm test             # stats + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single reader, no login.

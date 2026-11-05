# Pacer

Running calculator: give any two of distance, time and pace and get the third, per-km or per-mile splits (even or negative-split), Riegel race predictions (5K → marathon), and saved goals with race dates.

- Accepts `10k`, `6.2 mi`, `half`, `800m`; times as `1:45:30`, `25:10.5`, `1h30m`
- Negative-split option: the second half is N % faster, totals are exact
- Pure shared module `src/pace.js`; zero runtime dependencies (Node ≥ 22.13)

```bash
npm start            # http://localhost:3000, DB at ./data/pacer.db (DB_PATH)
npm test             # maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available).

# Subtrack

Track subscriptions: weekly, monthly or yearly plans (every N units), next renewal, monthly and yearly equivalents, an upcoming-payments list for 14/30/90 days with the total due, spend by category, and the savings from what you cancelled.

- Renewal maths anchors to the **original day**: a plan started on Jan 31 renews Feb 28 → Mar 31 → Apr 30; a Feb 29 yearly plan renews Feb 28 in common years (verified against a brute-force reference over 400 days)
- Money in integer cents; API prices are text (`"15.99"`); weekly plans convert at 52/12 weeks a month
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/subs.js`

```bash
npm start            # http://localhost:3000, DB at ./data/subtrack.db (DB_PATH)
npm test             # date/cost maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single user, no login.

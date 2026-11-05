# Raffl

Fair, **verifiable** random draws. Every result is a pure function of the entry list, the settings and a **seed**, so anyone who knows the seed can reproduce it — and the *Verify* button (and `POST /api/verify`) re-computes it and says whether it matches.

- **Winners** — weighted successive sampling (`Ann x3` = three tickets), distinct winners; frequencies are checked statistically in the tests
- **Groups** — seeded Fisher–Yates shuffle dealt round-robin, so sizes differ by at most one
- **Secret Santa** — a derangement (nobody draws themselves), optionally one big circle; results stay hidden behind per-person *Reveal* buttons
- Parser details: `x3`, `*3`, `× 3` set a weight, but names that merely end in x (`Max`, `Box 2`) are left alone (a bug the tests caught)
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/draw.js`. Randomness is a seeded PRNG for reproducibility — it's for raffles and team splits, **not** for security-sensitive lotteries.

```bash
npm start            # http://localhost:3000, DB at ./data/raffl.db (DB_PATH)
npm test             # draw maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single user, no login.

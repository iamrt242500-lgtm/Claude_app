# Ledgerly

Small-business double-entry bookkeeping. A seeded chart of accounts, journal entries that **must balance** (≥ 2 lines, one side per line, integer cents), an **immutable journal** (corrections are made by voiding, which posts a linked reversing entry), per-account ledgers with running balances in the natural direction, a trial balance, an income statement for any period and a cumulative balance sheet that balances (assets = liabilities + equity + retained earnings).

- Amounts are text in the API (`"1,234.50"`); bare JSON numbers are rejected so nobody posts 12 cents by accident
- Accounts with entries can be archived but not deleted, and their type is locked
- Entry + lines are written in one transaction (a failed entry leaves nothing behind)
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/ledger.js`

```bash
npm start            # http://localhost:3000, DB at ./data/ledgerly.db (DB_PATH)
npm test             # accounting rules + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single user, no login — put it behind your own auth before exposing it.

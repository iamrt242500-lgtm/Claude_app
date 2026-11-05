# Stockpile

Small-shop inventory with **FIFO costing**. Receive stock at a unit cost, issue it (the oldest cost layer is consumed first, so cost of goods sold is exact in integer cents), adjust counts (write-offs are reported as *shrinkage*, separate from COGS). Valuation as of any date, days of cover from the last 30 days of usage, reorder points and a reorder list.

- The movement log is replayed in (date, id) order, so **backdated entries re-cost everything after them**; any insert or delete that would take stock below zero at any point in time is refused (HTTP 409) with the date and quantity
- Items with history are archived, not deleted
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/inventory.js`

```bash
npm start            # http://localhost:3000, DB at ./data/stockpile.db (DB_PATH)
npm test             # costing + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single user, no login.

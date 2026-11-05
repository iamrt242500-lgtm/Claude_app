# Evenly — split group expenses and settle up with fewer payments

Create a group (EUR/USD/GBP), add expenses paid by anyone and split them **equally, by shares, by percent or by exact amounts**. See who owes whom, get a **minimal settle-up plan** (at most n−1 transfers) and record payments to bring balances to zero. Edit/delete expenses, add/remove people (blocked while a person is part of expenses or payments), undo payments.

**Money correctness (unit + property tested):** integer cents only; splits use the largest-remainder method so shares always sum **exactly** to the total (e.g. €100.00 / 3 → 33.34 + 33.33 + 33.33, ties to the lowest id); exact/percent splits must add up or are rejected with a precise message; balances always sum to 0; a 200-scenario randomized test asserts that applying the suggested payments clears every balance in ≤ n−1 transfers.

```bash
cd apps/evenly && npm start      # http://localhost:3000 (PORT, DB_PATH=./data/evenly.db)
npm test                          # 15 unit/property + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/groups`, `GET/DELETE /api/groups/:id`, `POST /api/groups/:id/members`, `DELETE …/members/:mid`, `POST …/expenses`, `PUT/DELETE …/expenses/:eid`, `POST …/settlements`, `DELETE …/settlements/:sid`, `GET /api/health`. Every mutation returns the full recomputed group (balances + suggestions).
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user, no auth/sharing between devices, one currency per group (no conversion), editing a shares/percent expense reopens it as exact amounts (same cents), not deployed.
**Found by E2E and fixed:** group creation stopped at the first validation error instead of reporting all fields.

# Pennywise — monthly budget tracker with bank-CSV import

Track income and expenses by category, give categories a **monthly budget**, and see per-category progress (on track → nearly there at ≥ 80% → over budget), totals, daily spending and a 6-month income/expense trend. Month navigation, search/filter, edit/delete, CSV export, and a careful **bank CSV import**: header auto-detection (date / amount **or** debit+credit / description / category), amounts like `$1,234.56`, `(12.50)`, `12.50-`, selectable date format (`YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`), a **dry-run preview** with per-line error messages, exact-duplicate skipping (also against existing data, so re-importing a file adds nothing), and categories created on the fly.

**Correctness choices (unit/API/E2E tested):** integer cents only; sign lives in `type`, stored amounts are positive; budget status is an integer comparison (79.99% is *not* "nearly there"); impossible dates (`2026-02-30`) rejected; ambiguous slash dates need an explicit format; invalid CSV lines never silently import — the commit refuses unless invalid lines are explicitly skipped; deleting a category keeps its transactions (uncategorized); CSV export neutralizes formula injection; search treats `%`/`_` literally.

```bash
cd apps/pennywise && npm start    # http://localhost:3000 (PORT, DB_PATH=./data/pennywise.db)
npm test                           # 12 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/categories`, `PUT/DELETE /api/categories/:id`, `GET/POST /api/transactions[?month&categoryId&type&q]`, `GET/PUT/DELETE /api/transactions/:id`, `GET /api/summary?month=`, `GET /api/export`, `POST /api/import {csv, dateOrder, dryRun, skipInvalid}`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS with SVG charts, zero runtime dependencies.
**Limitations:** single user, no auth, USD only, no recurring transactions or budget rollover, a month's budget is the category's current budget (history isn't versioned), duplicate detection is by exact date+amount+description, not deployed.
**Found while testing and fixed:** 79.99% of a budget rounded up into "nearly there".

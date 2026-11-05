# Cronwise — cron expression explainer, verifier and schedule keeper

Type a 5-field cron expression and instantly get a plain-English description, a per-field breakdown, and the next 8 run times (UTC and your local time). Invalid expressions get a precise error (out-of-range values, bad steps/ranges, wrong field count, schedules that can never run like `0 0 31 2 *`). Save named schedules; they persist in SQLite and show their next run.

Supports `*`, lists, ranges, steps (`*/15`, `10-30/10`, `5/15`), month/day names (`jan`, `mon-fri`), `7` as Sunday, and `@hourly @daily @weekly @monthly @yearly` aliases. When both day-of-month and weekday are restricted a run happens if **either** matches (standard cron semantics). Everything is evaluated in **UTC**; seconds, `L`/`W`/`#` extensions and non-UTC zones are not supported.

```bash
cd apps/cronwise && npm start    # http://localhost:3000 (PORT, DB_PATH=./data/cronwise.db)
npm test                          # 11 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `POST /api/explain {expr,count≤25}` → `{valid, description, next[]}` or `{valid:false,error}`; `GET/POST /api/jobs`, `PUT/DELETE /api/jobs/:id` (`{label, expr}`), `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies. Single user, no auth, not deployed.
**Found by review and fixed:** an unreadable description for `*/5 9-17 * * 1-5` (spotted in a mobile screenshot).

# Streakline — habit tracker with schedule-aware streaks

Create habits for the weekdays that matter (daily, weekdays, any custom set). Check them off on the **Today** view; open a habit for current/longest streak, 30-day completion rate and a 12-week heatmap where you can click any past day to backfill or undo.

**Streak rules (unit-tested):** only *scheduled* days count; unscheduled days are skipped, not misses; today is a grace day (not done yet ≠ broken); check-ins on unscheduled days don't count toward or against a streak; the completion rate ignores today until it's done. Future check-ins are rejected.

**Time zones:** the browser sends its local date (`?today=`); the server accepts it only within ±1 day of server UTC, otherwise falls back to UTC — so users anywhere get their own "today" without trusting arbitrary dates.

```bash
cd apps/streakline && npm start   # http://localhost:3000 (PORT, DB_PATH=./data/streakline.db)
npm test                           # 12 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/habits`, `GET/PUT/DELETE /api/habits/:id`, `PUT|DELETE /api/habits/:id/checkins/:YYYY-MM-DD` (idempotent), `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user, no auth, no reminders/notifications, streak/rate recomputed per request (fine for personal-scale data), not deployed.

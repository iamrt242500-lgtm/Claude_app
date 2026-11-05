# Focusly — Pomodoro / focus timer whose state lives on the server

Start a focus session (default 25 min), short break (5) or long break (15) — durations are configurable per browser. The countdown is computed from the **server's end timestamp**, so it survives reloads, closed tabs, throttled background tabs and sleeping laptops. When time is up the session **completes by itself** (lazily on the server: `finishedAt = endsAt`, even if no browser was open), the page beeps (optional) and shows a toast. Stats: focus today, sessions today, streak (with a grace day), total focus, 14-day chart, top labels, recent sessions (delete entries). Early stops are recorded as *cancelled* and never count; breaks never count as focus.

**Design notes (tested):** one active session at a time, enforced by a partial unique index (a second tab gets 409 and re-syncs); the browser corrects for clock skew using the server's `now`; "today"/streak use the browser's UTC offset (`?tz=`, validated ±14 h); the document title shows the remaining time; timer maths (`formatClock`, `streak`, `summarize`) live in `src/timer.js` and are shared by server, browser and tests.

```bash
cd apps/focusly && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/focusly.db)
npm test                          # 12 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # drives server AND browser clocks together
```
**API:** `GET /api/state?tz=`, `POST /api/sessions/start {kind, minutes, label?}`, `POST /api/sessions/stop`, `DELETE /api/sessions/:id`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS ES modules, SVG ring, Web Audio beep, zero runtime dependencies.
**Limitations:** single user, no auth, no pause/resume (by design: pause makes focus stats ambiguous), no desktop notifications, no cross-device settings, not deployed.
**Found by E2E and fixed:** a failed initial load left the page on "Loading…" with only a transient toast — it now shows a Retry banner.

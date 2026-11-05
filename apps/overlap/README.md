# Overlap — find a meeting time across time zones (DST-aware)

Pick 2–8 cities, a date and working hours; Overlap draws each person's working hours on a 24-hour timeline, highlights when **everyone** is inside theirs, and lists every common window with the local start/end time in each zone (plus the local date). Save zone sets as named teams.

**Why it's trickier than it looks (all unit/API/E2E tested):**
- The US and Europe change clocks on different dates, so New York–London overlap is 3 h, becomes **4 h** for the weeks in between, then 3 h again (2026-03-02 / 03-09 / 04-06).
- Half-hour and 45-minute zones (India +5:30, Nepal +5:45, Lord Howe's 30-minute DST) are exact: the grid is 15-minute resolution, so India–London is 3 h 30 m, not a truncated 3 h; Nepal–India is 7 h 45 m.
- The day is the 24 hours from local midnight in the first zone, so spring-forward (skipped 02:00) and fall-back (repeated 01:00) days are handled by real instants, not "+24 h" arithmetic.
- Zone IDs: both modern (`Asia/Kolkata`, `Europe/Kyiv`) and legacy (`Asia/Calcutta`) spellings validate, and the picker lists modern names (`Intl.supportedValuesOf` only returns legacy IDs).

```bash
cd apps/overlap && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/overlap.db)
npm test                          # 13 unit + API tests (DST transition instants, offsets, overlap, validation)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `POST /api/overlap {zones[2..8], date, start, end}`, `GET /api/zones?q=`, `GET/POST /api/teams`, `GET/PUT/DELETE /api/teams/:id`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite` + built-in `Intl` (no tz database package), vanilla JS with SVG timeline, zero runtime dependencies.
**Limitations:** results depend on the Node/browser ICU time-zone data version; working hours are whole hours and the same for everyone (no per-person hours, lunch breaks or weekends/holidays); the overlap is for one day; single user, no auth; not deployed.
**Found while testing and fixed:** an hourly grid anchored to the first zone truncated overlaps with :30/:45 zones (now 15-minute slots); `Intl.supportedValuesOf` rejected modern zone IDs like `Asia/Kolkata`.

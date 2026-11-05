# Gearlog

Vehicle logbook. **Fuel economy** uses the full-tank method: consumption is measured between two *full* fill-ups, and partial fills in between count toward the later full one (measuring each fill alone gives nonsense). Averages are distance-weighted, and fuel cost per km comes from the money spent over the measured distance. **Maintenance reminders** per task by distance, time or both — whichever comes first — with ok / due soon (10 % of the km interval or 14 days) / overdue / never-done states.

- Odometer readings must fit between the readings on earlier and later dates, so backdated entries can't silently corrupt trips
- Amounts are text in the API (`"41.250"` litres, `"62.40"` money)
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/car.js`

```bash
npm start            # http://localhost:3000, DB at ./data/gearlog.db (DB_PATH)
npm test             # fuel/service maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single user, no login.

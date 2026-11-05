# Pollbox — quick polls with a share link and a private admin link

Create a poll (2–10 options, single or multiple choice, optional closing time, results policy), get a **voter link** and a one-time **admin link**. Voters vote once (they can change their vote until the poll closes); everyone sees live results according to the policy: *always*, *after you vote*, or *only when the poll closes*. The admin link shows full results and the number of distinct voters and lets you close, reopen, set a deadline or delete the poll.

**How the security model works (tested):** the poll URL contains a random public slug; management uses a separate 192-bit admin token that is returned **once** and stored only as a SHA-256 hash (the slug is not an admin credential — API tests prove it). Voters are identified by an HttpOnly, SameSite=Lax cookie holding a random id; one voter id = one vote set, and re-voting *replaces* it. Results that the policy hides are **omitted from the API response**, not merely hidden in the UI. Votes on closed/expired polls get 409; a poll can't be reopened while its deadline has passed; create/vote endpoints are rate-limited per client address (429 + `Retry-After`, `TRUST_PROXY=1` to use `X-Forwarded-For` behind a proxy).

```bash
cd apps/pollbox && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/pollbox.db, TRUST_PROXY=1 behind a reverse proxy)
npm test                          # 13 unit + API tests (cookie jar "browsers", injectable clock, rate limiter)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # each voter is a separate browser context
```
**API:** `POST /api/polls` → `{…, adminToken}`; `GET /api/polls/:slug`; `POST /api/polls/:slug/vote {options:[ids]}`; `GET|DELETE /api/admin/:token`; `POST /api/admin/:token/close|reopen|deadline`; `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite` + `node:crypto`, vanilla JS, zero runtime dependencies.
**Limitations (be honest about what "one person, one vote" means here):** it is cookie-based, so someone who clears cookies or uses another browser can vote again — this is fine for casual team/friends polls but **not** for elections; there are no accounts or per-voter audit trail; the admin token is a bearer secret (anyone with the link controls the poll; serve over HTTPS); polls never expire from the database; not deployed.
**Found while testing:** my first "forged cookie" test assumed a 17-character id was invalid — format validation only rejects malformed ids, so the test (not the app) was corrected and the limitation documented.

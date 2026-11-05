# Shortly — link shortener with click analytics

Turn long URLs into `/s/<code>` links (random 6-char codes from an unambiguous alphabet, or your own slug), optionally with a title and expiry date. Every visit is a **302 redirect** that is counted; the stats page shows human vs. bot/preview clicks, a 30-day chart, top referrer hosts and device types. Disable/enable, delete, copy-to-clipboard.

**Safety rules (unit/API/E2E tested):** only `http`/`https` destinations (no `javascript:`, `data:`, `file:` …); no embedded credentials; length ≤ 2048; links pointing back at this service are refused (redirect-loop guard); reserved slugs (`api`, `s`, …); slugs unique case-insensitively; expiry is valid through the whole expiry day (UTC) and later returns **410 Gone**; disabled links return 410; unknown codes return a friendly 404; redirects are `no-store`; `HEAD` requests are not counted; headless/crawler/preview user agents are classed as bots and excluded from human counts. Referrers are stored as hostnames only.

```bash
cd apps/shortly && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/shortly.db)
npm test                          # 11 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # follows real redirects to a second local server
```
**API:** `GET/POST /api/links` (`{url, slug?, expiresOn?, title?}`), `GET/PATCH/DELETE /api/links/:id` (GET returns analytics; PATCH `{disabled?, expiresOn?}`), `GET /s/:code` (redirect), `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user, no auth (anyone who can reach `/api` can manage links — put it behind auth/VPN before exposing it), no rate limiting, unique-visitor counting not possible without cookies/IP storage (intentionally not collected), no QR codes, not deployed.
**Found while testing and fixed (also in other apps):** `toISOString()` on an invalid date threw → HTTP 500 for `2026-13-01`; lenient `Date.parse` accepted `2026-02-30`.

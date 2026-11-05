# Test report
Run on Node 22.23 in the build container.
| Suite | Result |
|---|---|
| `npm run check` (syntax) | pass |
| `npm test` — 13 tests (validation, Brier/bucket math, CRUD lifecycle, 422/400/404/405, CSV injection, traversal, security headers, password auth) | 13/13 pass |
| `npm run test:e2e` — 13 browser steps (empty state, validation, create + reload persistence, edit, review, stats, search/filter, delete, 404, forced 500 + retry, network abort, XSS payload, 375 px overflow check) | all pass (Chromium) |
**Bug found by screenshot review and fixed:** Overview rendered `[object HTMLElement]` (array passed to `replaceChildren`); an E2E assertion now guards it. Earlier E2E failures were test-script mistakes (date ordering rule, leftover filter state), not product bugs.
**Not done:** no linter (none configured), no `npm audit` beyond install output (0 vulnerabilities), no automated accessibility audit, no load testing, Docker image build not verified (no daemon here).

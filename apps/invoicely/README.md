# Invoicely — invoices for freelancers

Manage clients and invoices end to end: line items with fractional quantities, tax %, USD/EUR/GBP, auto numbering (`INV-0001`…), a **draft → sent → paid** workflow (with undo), derived **overdue** status, a dashboard (outstanding / overdue / paid this year per currency, paid revenue by month) and a clean **printable invoice** (Print / PDF via the browser; print stylesheet hides all app chrome).

**Correctness choices:** money is stored as integer cents and computed server-side (the UI only previews); line totals and tax are rounded half-up to the cent; sent/paid invoices are locked from editing; a client with invoices cannot be deleted (409); invoices are only deletable as drafts; `due ≥ issue` is enforced.

```bash
cd apps/invoicely && npm start    # http://localhost:3000 (PORT, DB_PATH=./data/invoicely.db)
npm test                           # 8 unit + API tests (injectable clock)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/clients`, `PUT/DELETE /api/clients/:id`; `GET/POST /api/invoices[?status=draft|sent|paid|overdue]`, `GET/PUT/DELETE /api/invoices/:id`, `POST /api/invoices/:id/status {status}`; `GET /api/summary`; `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user, no auth, no emailing/PDF generation (use browser print), no multi-currency conversion (totals are per currency), UTC dates, not deployed.
**Found by E2E/screenshot review and fixed:** dashboard rendered `[object HTMLDivElement]` (array passed to `replaceChildren`); full-width single bar and broken totals rule.

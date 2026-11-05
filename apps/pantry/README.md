# Pantry — recipes, weekly meal plan and one combined shopping list

Write recipes with plain-text ingredient lines (`1 1/2 cups flour, sifted`, `½ tsp salt`, `2-3 cloves garlic`, `500g spaghetti`, `salt to taste`), then: **scale servings** with −/+ (fractions stay readable: ¾ cup, ⅓ cup), **convert units** between "as written", metric and US, **plan meals** on a Monday–Sunday grid (servings can differ per entry), and get a **shopping list** that merges the same ingredient across recipes and units, with tick boxes that persist per week.

**The tricky parts (unit-tested):** an ingredient parser for integers, decimals, mixed numbers, Unicode fractions (`1½`), ranges (`2-3`, `1 to 2`), unit aliases (`tablespoons`, `lb.`, `fl oz`), "of", parenthetical notes and "to taste" — it never throws on junk input; exact conversion constants (US cup = 236.588 ml, tbsp = 14.7868 ml, oz = 28.3495 g, lb = 453.592 g) with readable output (`235 ml`, `1.1 lb`, nearest ⅛/⅓/⅔ fractions, tiny amounts never shown as "0"); light singularization so `2 eggs` + `1 egg` and `3 tomatoes` + `1 tomato` merge but `molasses`/`hummus` do not; aggregation sums in base units per dimension — **volume and weight of the same ingredient stay separate** (no density guessing) and "salt to taste" lines are not merged with measured ones. Stored recipe text is never rewritten by scaling or conversion.

```bash
cd apps/pantry && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/pantry.db)
npm test                         # 13 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/recipes[?q]`, `GET /api/recipes/:id?servings=&system=original|metric|us`, `PUT/DELETE /api/recipes/:id`; `GET /api/plan?week=`, `POST /api/plan`, `DELETE /api/plan/:id`; `GET /api/shopping?week=&system=metric|us`, `POST /api/shopping/check?week=`; `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, `src/food.js` shared by server/browser/tests, zero runtime dependencies.
**Limitations:** conversions are exact, not "kitchen-rounded" (250 ml shows as 1.06 US cups); US customary units only (no UK/imperial pints); no density tables, ingredient categories/aisles, nutrition, images or recipe import; singularization is a heuristic; single user, no auth; not deployed.
**Found while testing and fixed:** `0.01` was displayed as "0"; rapid clicks on the servings stepper lost increments (a stale response overwrote the local count).

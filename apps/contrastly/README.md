# Contrastly

WCAG 2.x contrast checker. Enter a text and background colour (hex, `rgb()`, `hsl()`, names, alpha) and see the ratio, AA/AAA pass/fail for normal text, large text and UI components, a live preview, and the nearest accessible text colour (same hue and saturation, only lightness moves). Save palettes and view an all-pairs contrast matrix.

- Ratios are truncated, not rounded, and compared unrounded — `#777` on white (4.478) never passes AA
- Translucent text is composited over the background; a translucent background is treated as over white
- Shared pure module `src/color.js` runs in the browser and on the server
- Zero runtime dependencies (Node ≥ 22.13)

```bash
npm start            # http://localhost:3000, DB at ./data/contrastly.db (DB_PATH)
npm test             # colour maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available).

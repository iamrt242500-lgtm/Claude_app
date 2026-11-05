#!/usr/bin/env bash
# Runs the syntax check and unit/API tests of every app (E2E needs a browser: run `npm run test:e2e` inside an app).
# Usage: scripts/test-all.sh            # all apps
#        scripts/test-all.sh --e2e      # also run each app's Playwright E2E (needs CHROMIUM_PATH or `npx playwright install chromium`)
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"; fail=0; e2e=0; [ "${1:-}" = "--e2e" ] && e2e=1
run() { # name dir
  printf '%-14s' "$1"
  if (cd "$2" && npm run -s check >/dev/null 2>&1 && npm test --silent 2>&1 | grep -qE '^# fail 0'); then printf 'check+tests OK'; else printf 'FAILED'; fail=1; fi
  if [ $e2e -eq 1 ]; then if (cd "$2" && npm run -s test:e2e 2>&1 | grep -q 'All E2E steps passed'); then printf '  e2e OK'; else printf '  e2e FAILED'; fail=1; fi; fi
  printf '\n'
}
run hindsight "$root"
for d in "$root"/apps/*/; do run "$(basename "$d")" "$d"; done
[ $fail -eq 0 ] && echo "All apps passed." || echo "Some apps failed."
exit $fail

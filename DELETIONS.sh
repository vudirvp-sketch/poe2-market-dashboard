#!/usr/bin/env bash
# DELETIONS.sh — iter 60 — removes 10 orphan root-level files (P2-11)
#
# These files were accidentally committed to the repo root in iter 58 (commit 048304f).
# Each has a canonical copy under src/, backend/, tests/, or e2e/ which is the version
# actually imported by the codebase. The root-level copies are stale duplicates that
# caused 2 tsc errors + 1 failing jest suite.
#
# Run from the ROOT of your poe2-market-dashboard checkout.
# Safe to re-run: git rm will no-op if a file is already removed.

set -euo pipefail

# Verify we are at repo root by checking for a known file
if [[ ! -f "package.json" || ! -f "pytest.ini" ]]; then
  echo "ERROR: Run this script from the root of poe2-market-dashboard (must contain package.json + pytest.ini)" >&2
  exit 1
fi

echo "Removing 10 orphan root-level files (P2-11)..."

# Frontend orphan files (caught by tsconfig.json include: "**/*.ts(x)")
git rm -f --ignore-unmatch dashboard-page.tsx
git rm -f --ignore-unmatch events-sidebar.spec.ts
git rm -f --ignore-unmatch providers.tsx
git rm -f --ignore-unmatch route.ts
git rm -f --ignore-unmatch use-price-stream.ts

# Backend orphan files (canonical copies live under backend/)
git rm -f --ignore-unmatch main.py
git rm -f --ignore-unmatch routes_sse.py
git rm -f --ignore-unmatch historical.py

# Test orphan files (canonical copies live under tests/; pytest.ini testpaths=tests
# so these were never collected, but they shadowed canonical names on import attempts)
git rm -f --ignore-unmatch test_lifecycle.py
git rm -f --ignore-unmatch test_optimal_currency.py

echo ""
echo "Done. Verify with:"
echo "  git status          # should show 10 deleted files staged"
echo "  ls dashboard-page.tsx 2>/dev/null && echo 'STILL EXISTS' || echo 'OK: removed'"
echo ""
echo "Canonical copies (should still exist):"
for f in src/components/dashboard/dashboard-page.tsx \
         e2e/events-sidebar.spec.ts \
         src/components/providers.tsx \
         src/app/api/flipper/prices/stream/route.ts \
         src/hooks/use-price-stream.ts \
         backend/main.py \
         backend/api/routes_sse.py \
         backend/data/historical.py \
         tests/test_lifecycle.py \
         tests/test_optimal_currency.py; do
  if [[ -f "$f" ]]; then
    echo "  [OK] $f"
  else
    echo "  [MISSING!] $f"
  fi
done

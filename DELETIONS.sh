#!/usr/bin/env bash
# DELETIONS.sh — iter 62 — removes 16 orphan files (P2-12)
#
# Two batches:
#   (A) 10 orphan root-level files accidentally committed in iter 58 (commit 048304f).
#       Each has a canonical copy under src/, backend/, tests/, or e2e/.
#   (B) 6 WebSocket file remnants from iter 58 WS removal (commit 048304f):
#       3 originals + 3 .DELETED.txt markers. The originals should have been
#       `git rm`'d in iter 58 but were left behind; the .DELETED.txt markers
#       were created as placeholders and never cleaned up.
#
# iter 60 (commit 9ee73ae) shipped an earlier version of this script but it was
# never executed — files remained in the repo. iter 62 finally runs it.
#
# Run from the ROOT of your poe2-market-dashboard checkout.
# Safe to re-run: `git rm --ignore-unmatch` will no-op if a file is already removed.

set -euo pipefail

# Verify we are at repo root by checking for a known file
if [[ ! -f "package.json" || ! -f "pytest.ini" ]]; then
  echo "ERROR: Run this script from the root of poe2-market-dashboard (must contain package.json + pytest.ini)" >&2
  exit 1
fi

echo "Removing 10 orphan root-level files (batch A — P2-11)..."

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
echo "Removing 6 WebSocket file remnants (batch B — P2-12 WS leftovers)..."
echo "  3 originals (should have been rm'd in iter 58):"
git rm -f --ignore-unmatch backend/api/routes_ws.py
git rm -f --ignore-unmatch src/hooks/use-websocket.ts
git rm -f --ignore-unmatch src/app/api/flipper/ws/info/route.ts

echo "  3 .DELETED.txt markers (placeholders from iter 58):"
git rm -f --ignore-unmatch backend/api/routes_ws.py.DELETED.txt
git rm -f --ignore-unmatch src/hooks/use-websocket.ts.DELETED.txt
git rm -f --ignore-unmatch src/app/api/flipper/ws/info/route.ts.DELETED.txt

echo ""
echo "Done. Verify with:"
echo "  git status              # should show 16 deleted files staged"
echo "  npx tsc --noEmit        # should print nothing (0 errors)"
echo "  npx jest                # should report 291 pass / 14 suites"
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

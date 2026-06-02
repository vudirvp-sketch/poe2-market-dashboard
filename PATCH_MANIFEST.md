# PoE2 Market Dashboard — Patch Manifest

## Files Modified (replace in your local repo)

| File | Change |
|------|--------|
| `backend/config.py` | CRITICAL-2: `league_name` default "vaal" → "runes" with comment |
| `src/app/api/flipper/heatmap/route.ts` | CRITICAL-2: league fallback "vaal" → "runes" |
| `src/app/api/flipper/benchmarks/[currency]/route.ts` | CRITICAL-3: `low_30d`/`high_30d` → `low30d`/`high30d` (camelCase fallback) |
| `src/app/api/flipper/storage-value/[currency]/route.ts` | CRITICAL-3: `confidenceLevel` → `significanceLevel` in inputs fallback |
| `src/components/dashboard/flips-table.tsx` | i18n: `Sort by ${label}` → `t("sortBy", { "0": label })` |
| `src/components/dashboard/flips-detail-dialog.tsx` | i18n: `(24h)` suffix → `t("suffix24h")` |
| `src/components/dashboard/forecast-tab.tsx` | i18n: ~12 hardcoded reason/timeframe strings → `t("forecastRec*")` keys |
| `src/lib/i18n/locales/en.ts` | Added 20 new translation keys (sortBy, suffix24h, forecastRec*) |
| `src/lib/i18n/locales/ru.ts` | Added 20 new Russian translation keys |
| `src/lib/i18n/locales/zh.ts` | Added 20 new Chinese translation keys |
| `src/lib/i18n/locales/ko.ts` | Added 20 new Korean translation keys |
| `tests/test_new_params.py` | Fixed flaky test: `assert acceleration > 0` → defensive comparison |

## Files Deleted (remove from your local repo)

| File | Reason |
|------|--------|
| `backend/api/routes_auth.py` | HIGH-4: Dead auth code — router never registered in main.py |
| `src/app/api/flipper/auth/start/route.ts` | HIGH-4: Dead auth proxy — calls backend endpoints that return 404 |
| `src/app/api/flipper/auth/callback/route.ts` | HIGH-4: Dead auth proxy — calls backend endpoints that return 404 |
| `tests/test_gold_costs.py` | HIGH-8: Tests deprecated gold_costs.py module |

## Git Commands to Apply Patch

```bash
# 1. Copy modified files from the archive into your repo root
#    (assuming you extracted the archive to a temp directory)
cp -r /path/to/poe2-patch/* /path/to/your/poe2-market-dashboard/

# 2. Delete the removed files
rm backend/api/routes_auth.py
rm -r src/app/api/flipper/auth/start/
rm -r src/app/api/flipper/auth/callback/
rm -r src/app/api/flipper/auth/
rm tests/test_gold_costs.py

# 3. Stage all changes
git add -A

# 4. Verify what changed
git status
git diff --cached --stat

# 5. Commit
git commit -m "fix: CRITICAL-2 league default, CRITICAL-3 fallback camelCase, HIGH-4 dead auth, HIGH-8 dead test, i18n forecast recommendations, fix flaky acceleration test"
```

## Verification

```bash
# TypeScript check
npx tsc --noEmit

# Build
npm run build

# Backend tests
python -m pytest tests/ -v --ignore=tests/test_gold_costs.py

# Frontend tests
npm test
```

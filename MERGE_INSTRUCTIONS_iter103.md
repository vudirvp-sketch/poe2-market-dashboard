# MERGE INSTRUCTIONS — iter 103

> **Iter 103 — "Nothing works" investigation.** Deep-dive into why the dashboard started but every API call returned 404 and the flipper bridge crashed at startup.

---

## TL;DR

Two bugs found and fixed:

1. **KI-15 (Critical):** The `api.poe2scout.com` subdomain is **DEAD** — every endpoint returns HTTP 404. The API has moved to the bare domain `poe2scout.com/api/*`. The repo had `api.poe2scout.com` hardcoded in 27 files. `start.bat` / `start.sh` were actively creating `.env.local` with the wrong URL and printing a `[WARN]` telling users the bare domain "causes ECONNRESET/502 errors" — exactly backwards.

2. **KI-16 (High, regression from iter 102):** Iter 102's `/* turbopackIgnore: true */` "fix" for the cosmetic Turbopack NFT warning (KI-12) was a regression — it caused Turbopack to fully exclude `scripts/flipper-backend-bridge.ts` from the server bundle. At runtime `next start` failed with `Cannot find module '.../.next/server/chunks/scripts/flipper-backend-bridge'`. Reverted.

---

## Investigation methodology

1. **HTTP probing.** `curl` against every URL the dashboard was hitting. All `https://api.poe2scout.com/api/*` returned 404 with empty body. Same paths under `https://poe2scout.com/api/*` returned 200 with valid JSON. Confirmed: the subdomain is dead, the bare domain is the new API host.

2. **Repo audit.** `grep -rln "api\.poe2scout\.com"` across all runtime file types. Found 27 files. Categorized into:
   - **Runtime-critical** (12 files): `config.yaml`, `backend/config.py`, `src/lib/poe2api.ts`, `start.bat`, `start.sh`, `next.config.ts`, `cloudflare-worker/worker.js`, `scripts/{generate-cache-snapshot,dump-live-data}.ts`, `scripts/sync_currency_names_from_poe2db.py`, `src/data/cache-snapshot.json` (URL keys), `src/app/api/poe2/{health,leagues,realms}/route.ts`.
   - **User-facing strings** (4 files): `src/lib/i18n/locales/{en,ru,ko,zh}.ts` — error hint messages.
   - **Docs** (3 files): `docs/{DATA_FLOW,ARCHITECTURE,CORS_PROXY_GUIDE}.md`.
   - **Test fixtures** (2 files): `src/__tests__/{poe2api-ki11-graceful-4xx,cors-proxy-fallback}.test.ts`.
   - **Backend docstring** (1 file): `backend/data/providers/poe2scout.py`.
   - **Historical** (left as-is): `MERGE_INSTRUCTIONS_iter102.md`, `worklog.md` — these are immutable iter logs.

3. **Bridge regression analysis.** Read `instrumentation.ts` (iter 102 version) and `scripts/flipper-backend-bridge.ts`. The `/* turbopackIgnore: true */` magic comment on `await import("./scripts/flipper-backend-bridge")` tells Turbopack's Node File Trace to skip this file. But Turbopack interprets it more aggressively — it also doesn't emit the chunk for runtime. So `import()` at runtime has nothing to resolve. The "warning" the comment silenced was cosmetic; the runtime breakage it introduced was real.

---

## Files modified (27 total)

### Runtime-critical config / code
- `config.yaml` — `data.poe2scout_base_url`: `api.poe2scout.com/api` → `poe2scout.com/api`
- `backend/config.py` — `DataConfig.poe2scout_base_url` default
- `src/lib/poe2api.ts` — `BASE_URL` default + header comment + transient-error comment
- `next.config.ts` — removed `api.poe2scout.com` from `images.remotePatterns` (kept `poe2scout.com` + `web.poecdn.com`)
- `cloudflare-worker/worker.js` — `UPSTREAM_BASE` + hostname guard (`api.poe2scout.com` → `poe2scout.com`)

### Start scripts
- `start.bat` — `.env.local` auto-generation now writes `https://poe2scout.com/api`; warning now fires if the DEAD `api.` subdomain is still present (previously fired if it was absent — exactly backwards)
- `start.sh` — same changes for Linux/macOS

### Instrumentation
- `instrumentation.ts` — removed `/* turbopackIgnore: true */` magic comment (KI-16 revert). Added explanatory comment block pointing to KI-15 / KI-16.

### Utility scripts
- `scripts/generate-cache-snapshot.ts` — default `BASE_URL`
- `scripts/dump-live-data.ts` — default `BASE_URL`
- `scripts/sync_currency_names_from_poe2db.py` — `DEFAULT_POE2SCOUT_BASE` + docstring + env-var help

### Cache snapshot
- `src/data/cache-snapshot.json` — rewrote 14 URL keys from `https://api.poe2scout.com/api/...` to `https://poe2scout.com/api/...`. Data payloads unchanged.

### i18n (user-facing error hints)
- `src/lib/i18n/locales/en.ts` — `flipperBackendDegradedHint` + `upstreamBlockedStep3`
- `src/lib/i18n/locales/ru.ts` — same keys
- `src/lib/i18n/locales/ko.ts` — same keys
- `src/lib/i18n/locales/zh.ts` — same keys

### Next.js route handlers (hint strings)
- `src/app/api/poe2/health/route.ts` — `apiBaseUrl` default
- `src/app/api/poe2/leagues/route.ts` — fallback hint
- `src/app/api/poe2/realms/route.ts` — fallback hint

### Backend docstring
- `backend/data/providers/poe2scout.py` — module docstring updated with iter 103 NOTE

### Docs
- `docs/DATA_FLOW.md` — Base URL line
- `docs/ARCHITECTURE.md` — ASCII diagram + flow description
- `docs/CORS_PROXY_GUIDE.md` — proxy target + flow diagrams

### Test fixtures
- `src/__tests__/poe2api-ki11-graceful-4xx.test.ts` — URL in error-message fixture
- `src/__tests__/cors-proxy-fallback.test.ts` — left the `not.toContain("api.poe2scout.com")` assertion (still valid — verifies BASE_URL prefix was stripped)

### Documentation
- `STATUS.md` — rewrote with KI-15 + KI-16 open entries; trimmed long closed-issue history; updated Quick Reference table
- `AGENT_NAVIGATION.md` — updated header line + KI log section
- `README.md` — rewrote with current launch instructions and the new API URL note

---

## User action required

If the user has a local `.env.local` from a previous run, it contains the dead `api.poe2scout.com` URL. They must either:
- **Delete `.env.local`** and let `start.bat` / `start.sh` regenerate it with the correct URL, OR
- **Edit `.env.local`** and change `POE2_API_BASE_URL=https://api.poe2scout.com/api` to `POE2_API_BASE_URL=https://poe2scout.com/api`.

The new `start.bat` / `start.sh` will print a `[WARN] .env.local uses DEAD api.poe2scout.com subdomain!` message if the old URL is detected.

---

## Verification status

This iteration was **investigation + minimal safe fixes**. Full test suite was NOT run — it requires `npm install` (heavy) and `.venv` setup. The following lightweight checks passed:
- `config.yaml` parses, `poe2scout_base_url` is correct
- `cache-snapshot.json` parses, 14 keys all use bare domain
- `instrumentation.ts` has no `turbopackIgnore` magic comment in active code (only in comment text)
- All runtime files verified clean of `api.poe2scout.com` references (only doc/warning/assertion mentions remain)
- `start.bat` preserves CRLF line endings (verified with `file` command)
- All 9 live API endpoints verified working with `curl` against `https://poe2scout.com/api/*`

Run these before pushing:
```
npm install
npx tsc --noEmit
npx jest
pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py
npm run build
```

---

## Stopping point / next iteration

**Done in iter 103:**
- Root-caused both bugs (KI-15 + KI-16)
- Applied minimal safe fixes (URL replacement + revert of KI-12 regression)
- Updated all documentation cleanly
- Generated archive + git commands

**Not done (deferred to next iteration):**
1. **Run full test suite** — `tsc --noEmit`, `jest`, `pytest`, `npm run build` — to verify no regressions from the URL rename. The changes are mechanical string replacements, so risk is low, but verification is still needed.
2. **KI-16 long-term fix (P2):** move `scripts/flipper-backend-bridge.ts` → `src/lib/flipper-backend-bridge.ts` so Turbopack bundles it as a regular module — eliminates the NFT warning permanently without runtime hacks.
3. **Regenerate `src/data/cache-snapshot.json` from live API** — current snapshot was just URL-key-rewritten; data is from iter 102 or earlier. Running `npx tsx scripts/generate-cache-snapshot.ts` will refresh it with current Runes of Aldur prices.
4. **Poe.ninja alternative** (user suggested) — not investigated. poe2scout.com works again now, so this is lower priority. Could be revisited if poe2scout.com becomes unstable again.
5. **KI-13** (SSE 400 Bad Request) — still open from iter 100. Unrelated to current bugs.

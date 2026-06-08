# Worklog

---
Task ID: 17
Agent: main
Task: Iteration 6 — BUG-7 through BUG-12, cold start timeout, rate limiting race

Work Log:
- Deleted `tailwind.config.ts` — dead code, Tailwind v4 ignores it (BUG-7)
- Removed `tailwindcss-animate` from package.json dependencies — replaced by `tw-animate-css` in devDependencies (BUG-7)
- Confirmed `components.json` tailwind.config: "" is correct for v4 CSS-first (BUG-8)
- Created `scripts/bump-sw-cache.js` — auto-busts SW cache version on every build (BUG-9)
- Added `postbuild` script in package.json: `node scripts/bump-sw-cache.js` (BUG-9)
- Added `/icon-1024.png` to STATIC_ASSETS in sw.js (BUG-9/BUG-10)
- Added icon-1024.png entry to manifest.json icons array (BUG-10)
- Added `--clean` flag to start.sh: removes .next + node_modules, reinstalls deps (BUG-11)
- Added `--clean` flag to start.bat: same deep-clean behavior (BUG-11)
- Pinned upper bounds (<next_major) for all 19 dependencies in requirements.txt (BUG-12)
- Changed `await check_provider_health()` to `asyncio.create_task()` in main.py lifespan — non-blocking startup
- Reduced health check timeout from 15s to 5s in check_provider_health()
- Added `_rate_limit_lock` (asyncio.Lock) in poe2scout.py to protect `_last_request_time` from race conditions
- Restructured _do_request(): rate-limit lock gates the read-check-sleep-update cycle, semaphore gates HTTP concurrency
- Updated AGENT_NAVIGATION.md to v1.21: added COMPLETED section, TODO items, Frequent Bugs #25-#28

Stage Summary:
- All 6 BUG tickets (BUG-7 through BUG-12) resolved
- Cold start timeout eliminated (asyncio.create_task + 5s timeout)
- Rate limiting race condition fixed (asyncio.Lock)
- Documentation updated (AGENT_NAVIGATION.md v1.21, worklog.md)

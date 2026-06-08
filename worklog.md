# Worklog

---
Task ID: 18
Agent: main
Task: Iteration 7 — PipelineCache LRU, venv fix, header fix, cleanup TODOs

Work Log:
- Added LRU eviction + max-entries cap (DEFAULT_MAX_ENTRIES=64) to PipelineCache using OrderedDict
- Expired/stale entries evicted first during put(), then LRU active entries
- PipelineCache.stats() now includes total_entries and max_entries
- Fixed backend startup: start.sh/start.bat now auto-create .venv and use venv python
- Added .venv/ to .gitignore
- Fixed header "More" button: split into scrollable bar + fixed button outside scroll area
- Removed stale TODO #1 (report default_league_value upstream) — workaround is stable
- Merged TODO #2 (live E2E verification) into remaining TODO list
- Marked TODO #3 (shadcn CLI v4) and #4 (PipelineCache) as completed
- Updated AGENT_NAVIGATION.md to v1.22

Stage Summary:
- PipelineCache now bounded (64 entries, LRU eviction)
- Backend should start reliably with venv (no more PEP 668 pip failures)
- Header "More" button always visible
- Documentation cleaned up, stale TODOs removed

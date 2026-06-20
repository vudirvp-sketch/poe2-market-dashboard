# MERGE INSTRUCTIONS — iter 61 (P1-7 EventManager async)

## Что в архиве

8 файлов с сохранением структуры папок для слияния с локальной копией репо:

```
backend/economy/events.py              — 4 sync → async methods
backend/api/routes_events.py           — 3 endpoints: await manager.<op>
tests/test_events.py                   — 25 tests → async (pytest-asyncio auto)
tests/test_routes_events_invalidation.py — _StubManager methods → async
tests/test_scheduler.py                — 1 test: await create_event
STATUS.md                              — P1-7 fixed, P3-8 fixed, P2-12 NEW
REFACTOR_PLAN.md                       — v25 → v26, est 13→12
worklog.md                             — iter 61 added, iter 55 dropped (≤5 rule)
```

## Применение

1. Скачайте архив `iter61_p1_7_eventmanager_async.tar.gz`.
2. Распакуйте поверх корня локального репо:
   ```bash
   cd /path/to/poe2-market-dashboard
   tar -xzf /path/to/iter61_p1_7_eventmanager_async.tar.gz
   ```
   Файлы заменят существующие (структура папок сохранена).
3. Проверьте diff: `git diff --stat` — должно быть 8 modified files.
4. Запустите тесты для проверки:
   ```bash
   pytest tests/test_events.py tests/test_routes_events_invalidation.py tests/test_lifecycle.py -v
   # ожидается: 56 passed
   ```
5. Закоммитьте и запушьте:
   ```bash
   git add -A
   git commit -m "refactor(P1-7): EventManager async — replace fire-and-forget with await"
   git push origin main
   ```

## Что закрывает

- **P1-7** — EventManager.create_event fire-and-forget SQLite write → FIXED
- **P3-8** — deprecated asyncio.get_event_loop() → FIXED (side effect)

## NEW Known Issue (P2-12)

В ходе iter 61 обнаружено: iter 60 коммит `9ee73ae` ("fix(P2-11)") обновил только
документацию, но `git rm` 10 orphan файлов не выполнил — они всё ещё в репо.
То же самое с iter 58 commit `048304f` — `routes_ws.py` переименован в `.DELETED.txt`
но оригинал (721 строка) оставлен. Зафиксировано в STATUS.md §P2-12, отложено на iter 62.

## Точка остановки

Iter 61 готова. Готов начать iter 62 = P2-12 (orphan files actual cleanup).

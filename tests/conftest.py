"""
Top-level pytest configuration for the PoE2 Flipper test suite.

KI-18 fix (iter 105): the production `find_triangular_arbitrage` and a few
sibling functions offload CPU-bound work to a `ProcessPoolExecutor` that
uses the `spawn` start method. In the test environment the spawned worker
process is terminated abruptly (BrokenProcessPool), and because the call
is wrapped in `asyncio.wait_for(loop.run_in_executor(...))`, pytest-asyncio
does not propagate the exception cleanly — the test hangs indefinitely
(pytest-timeout's thread method cannot interrupt it).

Fix: force `backend.main.get_process_pool()` to return None for the whole
test session. `find_triangular_arbitrage` then falls back to the default
`ThreadPoolExecutor`, which is plenty fast for the small synthetic test
inputs and does not require spawning a child process.

This is a TEST-ONLY patch — production code still uses the
ProcessPoolExecutor for GIL bypass on heavy Bellman-Ford / cross-rate
computation. The patch is applied via an autouse fixture so it covers
every test in the suite, including ones that import
`find_triangular_arbitrage` indirectly through route handlers.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _disable_process_pool_executor():
    """Force `get_process_pool()` to return None for the duration of each test.

    This makes `loop.run_in_executor(None, ...)` use the default
    ThreadPoolExecutor, avoiding the BrokenProcessPool hang described in
    KI-18. The fixture is autouse so it applies to every test without
    requiring an explicit dependency.
    """
    import backend.main

    original = backend.main.get_process_pool
    backend.main.get_process_pool = lambda: None
    try:
        yield
    finally:
        backend.main.get_process_pool = original

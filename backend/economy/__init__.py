# backend/economy — economy and lifecycle modules for the PoE2 Flipper backend.
#
# Submodules:
#   lifecycle.py — league phase detection (EARLY / MID / LATE)
#   momentum.py  — PriceMomentumTracker (momentum, volatility, acceleration)
#   events.py    — EventManager (manual market events, score penalties)
#
# NOTE: gold_costs.py and gold_cost_table.py were removed from active use.
# Gold/commission fees are intentionally excluded from all scoring, arbitrage,
# and storage-value calculations (see PoE2_Flipper_Canonical_Formulas.md §3
# DEPRECATED, §6.4 DEPRECATED). The files are kept in the repository only as
# reference for a potential future "fee-aware" display mode.

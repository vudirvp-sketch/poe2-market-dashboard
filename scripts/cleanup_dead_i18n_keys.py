"""
iter 89 — Dead i18n key cleanup.

Removes the following dead keys from all 4 locale files (en/ru/zh/ko):
- 24 graphXxx keys (left over from Currency Graph tab removal in iter 87)
- tabGraph (also from Currency Graph tab removal)
- tabForecast (Forecast tab was removed in an earlier iteration; key became fully dead
  after iter 89 KI-6 fix updated shortcuts-dialog.tsx to not reference it anymore)
- tabPortfolio (Portfolio tab was removed in an earlier iteration; key became fully dead
  after iter 89 KI-6 fix updated shortcuts-dialog.tsx to not reference it anymore)

Also collapses the now-empty "Currency Graph Tab" and "Currency Graph — SVG labels"
sections into single-line comment markers so future agents know they were intentionally
removed.

The script reads each file, applies the regex/string substitutions, and writes back.
Idempotent — running it twice produces the same output.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

LOCALE_DIR = Path("/home/z/my-project/repo/src/lib/i18n/locales")
LOCALES = ["en", "ru", "zh", "ko"]

# Dead keys to remove (each on its own line). The value portion matches anything
# up to the trailing comma+newline. We use re.escape on the key prefix and a
# permissive value pattern.
DEAD_KEY_NAMES = [
    "graphCurrencies",
    "graphTradePairs",
    "graphDensity",
    "graphArbCycles",
    "graphFocusOn",
    "graphAllCurrencies",
    "graphZoomIn",
    "graphZoomOut",
    "graphResetZoom",
    "graphNoData",
    "graphNoDataDesc",
    "graphNoNodes",
    "graphAriaLabel",
    "graphLegendStable",
    "graphLegendModerate",
    "graphLegendVolatile",
    "graphLegendArbCycle",
    "graphDetectedCycles",
    "graphNodeDetail",
    "graphNodeVolume",
    "graphNodeConnections",
    "graphNodeCluster",
    "graphArbCycleLabel",
    "graphArbCycleTooltip",
    "tabGraph",
    "tabForecast",
    "tabPortfolio",
    # Fallback titles for tabs/dialogs that no longer exist
    "fallbackForecasts",     # Forecast tab removed
    "fallbackPortfolio",     # Portfolio tab removed
    "fallbackCurrencyGraph", # Currency Graph tab removed iter 87
]

# Section header comments that previously introduced the graphXxx blocks.
# After removing the keys, the section is empty — we replace the header with a
# removal marker so the file structure is preserved and future agents see the
# deletion note.
SECTION_HEADERS_TO_REPLACE = [
    # (old header line, new header line + note)
    (
        "  // ---- Currency Graph Tab ----",
        "  // ---- Currency Graph Tab ---- REMOVED iter 89 (tab removed iter 87, keys were dead)\n"
        "  // All 22 graph* keys removed — they existed only in locale files, no live references in src/.\n"
        "  // Kept as a comment marker so agents looking for the old section know it was intentionally deleted.",
    ),
    (
        "  // ---- Currency Graph — SVG labels ----",
        "  // ---- Currency Graph — SVG labels ---- REMOVED iter 89 (same as above)\n"
        "  // graphArbCycleLabel + graphArbCycleTooltip removed — dead keys.",
    ),
]

# For the Portfolio Tab section, replace the header comment so it notes the
# tabPortfolio + tabGraph removal.
PORTFOLIO_HEADER_OLD = "  // ---- Portfolio Tab ----"
PORTFOLIO_HEADER_NEW = (
    "  // ---- Portfolio Tab ---- (tabPortfolio + tabGraph removed iter 89 — "
    "Portfolio tab + Currency Graph tab were both removed in earlier iterations)"
)


def remove_dead_keys(content: str) -> str:
    """Remove each dead key line (key + value + trailing comma + newline)."""
    for key in DEAD_KEY_NAMES:
        # Match: 2 spaces indent + key + ":" + anything + "," + newline
        # The "anything" is non-greedy and excludes newlines.
        pattern = re.compile(r"^  " + re.escape(key) + r": [^\n]*,\n", re.MULTILINE)
        new_content, count = pattern.subn("", content)
        if count == 0 and key in content:
            # Could happen if the key is on a different indent — log but don't fail
            print(f"  WARNING: key '{key}' not matched on its own line (may already be removed)")
        content = new_content
    return content


def replace_section_headers(content: str) -> str:
    """Replace the now-orphaned section headers with removal markers."""
    for old, new in SECTION_HEADERS_TO_REPLACE:
        if old in content:
            content = content.replace(old, new, 1)
    # Portfolio section header
    if PORTFOLIO_HEADER_OLD in content:
        content = content.replace(PORTFOLIO_HEADER_OLD, PORTFOLIO_HEADER_NEW, 1)
    return content


def collapse_blank_lines(content: str) -> str:
    """Collapse 3+ consecutive newlines into 2 (in case removing keys left big gaps)."""
    return re.sub(r"\n{3,}", "\n\n", content)


def process_file(path: Path) -> tuple[int, int]:
    """Process one locale file. Returns (lines_before, lines_after)."""
    before = path.read_text(encoding="utf-8")
    lines_before = before.count("\n")
    after = remove_dead_keys(before)
    after = replace_section_headers(after)
    after = collapse_blank_lines(after)
    lines_after = after.count("\n")
    if before != after:
        path.write_text(after, encoding="utf-8")
    return lines_before, lines_after


def main() -> int:
    total_removed = 0
    for locale in LOCALES:
        path = LOCALE_DIR / f"{locale}.ts"
        if not path.exists():
            print(f"ERROR: {path} not found", file=sys.stderr)
            return 1
        before, after = process_file(path)
        delta = before - after
        total_removed += delta
        print(f"  {locale}.ts: {before} → {after} lines (−{delta})")
    print(f"\nTotal lines removed across {len(LOCALES)} locales: {total_removed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

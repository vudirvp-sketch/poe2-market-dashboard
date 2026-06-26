"""iter 89 — Fix duplicate comment suffix in ru/zh/ko locale files.

The cleanup_dead_i18n_keys.py script had a bug where `str.replace` matched the
section header as a SUBSTRING inside the already-replaced comment, causing the
"REMOVED iter 89" suffix to be appended multiple times. This script finds and
removes the duplicate suffixes.

Pattern to fix in each file:
  // ---- Currency Graph Tab ---- REMOVED iter 89 (...)
  // All 22 graph* keys removed ...
  // Kept as a comment marker ... REMOVED iter 89 (...)        <-- duplicate suffix here
  // Kept as a comment marker ...                                <-- may also be duplicated

And:
  // ---- Currency Graph — SVG labels ---- REMOVED iter 89 (...)
  // graphArbCycleLabel + graphArbCycleTooltip removed — dead keys. REMOVED iter 89 (same as above)  <-- dup

And:
  // ---- Portfolio Tab ---- (tabPortfolio + tabGraph removed iter 89 — ...) (tabPortfolio + tabGraph removed iter 89 — ...)  <-- dup
"""
from pathlib import Path
import re

LOCALE_DIR = Path("/home/z/my-project/repo/src/lib/i18n/locales")
FILES = [LOCALE_DIR / f"{loc}.ts" for loc in ("ru", "zh", "ko", "en")]

# Patterns: (regex, replacement). The regex matches the duplicated suffix
# and replaces with just the first occurrence.
FIXES = [
    # Currency Graph Tab section: collapse "...deleted. REMOVED iter 89..." → "...deleted."
    (
        re.compile(
            r"(// Kept as a comment marker so agents looking for the old section know it was intentionally deleted\.)"
             r" REMOVED iter 89 \(tab removed iter 87, keys were dead\)\n"
             r"  // All 22 graph\* keys removed — they existed only in locale files, no live references in src/\.\n"
             r"  // Kept as a comment marker so agents looking for the old section know it was intentionally deleted\.",
            re.MULTILINE,
        ),
        r"\1",
    ),
    # Currency Graph SVG labels section: collapse duplicate "REMOVED iter 89 (same as above)" suffix
    (
        re.compile(
            r"(// graphArbCycleLabel \+ graphArbCycleTooltip removed — dead keys\.)"
             r" REMOVED iter 89 \(same as above\)\n"
             r"  // graphArbCycleLabel \+ graphArbCycleTooltip removed — dead keys\.",
            re.MULTILINE,
        ),
        r"\1",
    ),
    # Portfolio section: collapse duplicate suffix
    (
        re.compile(
            r"(// ---- Portfolio Tab ---- \(tabPortfolio \+ tabGraph removed iter 89 — Portfolio tab \+ Currency Graph tab were both removed in earlier iterations\))"
             r" \(tabPortfolio \+ tabGraph removed iter 89 — Portfolio tab \+ Currency Graph tab were both removed in earlier iterations\)",
        ),
        r"\1",
    ),
]


def main() -> int:
    for path in FILES:
        if not path.exists():
            print(f"  SKIP {path.name}: not found")
            continue
        content = path.read_text(encoding="utf-8")
        original = content
        for pattern, repl in FIXES:
            content = pattern.sub(repl, content)
        if content != original:
            path.write_text(content, encoding="utf-8")
            print(f"  FIXED {path.name}")
        else:
            print(f"  OK    {path.name} (no duplicates)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

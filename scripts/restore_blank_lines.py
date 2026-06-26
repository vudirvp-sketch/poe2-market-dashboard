"""iter 89 — Restore blank lines around the REMOVED iter 89 comment markers in ru/zh/ko.

The previous cleanup script's `collapse_blank_lines` step was too aggressive —
it removed the blank line between the comment marker block and the next section
header. This script adds the blank line back for visual consistency with en.ts.

Pattern before:
  // ---- Currency Graph Tab ---- REMOVED iter 89 (...)
  // All 22 graph* keys removed — ...
  // Kept as a comment marker ...
  // ---- Sticky Bar ----

Pattern after:
  // ---- Currency Graph Tab ---- REMOVED iter 89 (...)
  // All 22 graph* keys removed — ...
  // Kept as a comment marker ...

  // ---- Sticky Bar ----
"""
from pathlib import Path
import re

LOCALE_DIR = Path("/home/z/my-project/repo/src/lib/i18n/locales")
FILES = [LOCALE_DIR / f"{loc}.ts" for loc in ("ru", "zh", "ko")]

# Add blank line between "intentionally deleted." and "// ---- Sticky Bar ----"
PATTERN_1 = re.compile(
    r"(  // Kept as a comment marker so agents looking for the old section know it was intentionally deleted\.)\n(  // ---- Sticky Bar ----)",
)

# Add blank line between "dead keys." and "// ---- Accessibility: Sort ----"
PATTERN_2 = re.compile(
    r"(  // graphArbCycleLabel \+ graphArbCycleTooltip removed — dead keys\.)\n(  // ---- Accessibility: Sort ----)",
)


def main() -> int:
    for path in FILES:
        content = path.read_text(encoding="utf-8")
        original = content
        content = PATTERN_1.sub(r"\1\n\n\2", content)
        content = PATTERN_2.sub(r"\1\n\n\2", content)
        if content != original:
            path.write_text(content, encoding="utf-8")
            print(f"  RESTORED blank lines in {path.name}")
        else:
            print(f"  OK {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

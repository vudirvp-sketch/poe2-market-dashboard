Files in this patch:

AGENT_NAVIGATION.md
PRODUCT_VISION.md
STATUS.md
backend/data/currency_names.json
src/lib/currency-names.ts
worklog.md

Merge these files into your local repo (overwrite). Then run:
  pytest tests/test_currency_names_ru.py tests/test_sync_currency_names.py -v
to verify (expected: 39 pass).

Then run git commands (see git_commands.txt).

Generated: iter 86 (F1 closure).

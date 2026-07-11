#!/bin/bash
# iter 105 — delete obsolete files from local repo before merging
# Run from the repo root (poe2-market-dashboard/).
set -e

echo "Deleting obsolete files (iter 105 cleanup)..."

# Bridge moved to src/lib/
rm -f scripts/flipper-backend-bridge.ts

# Old iter archives (only iter 105 archive kept)
rm -f MERGE_INSTRUCTIONS_iter101.md
rm -f MERGE_INSTRUCTIONS_iter102.md
rm -f MERGE_INSTRUCTIONS_iter103.md
rm -f git_commands_iter101.txt
rm -f git_commands_iter102.txt
rm -f git_commands_iter103.txt

# Runtime log (now gitignored)
rm -f flipper-bridge.log

echo "Done. Obsolete files removed."
echo ""
echo "Next: extract iter105_archive.zip over this directory,"
echo "then run verification commands from MERGE_INSTRUCTIONS_iter105.md."

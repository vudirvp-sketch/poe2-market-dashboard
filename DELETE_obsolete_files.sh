#!/bin/bash
# iter 107 — delete obsolete files from local repo before merging
# Run from the repo root (poe2-market-dashboard/).
set -e

echo "Deleting obsolete files (iter 107 cleanup)..."

# Bridge moved to src/lib/ (iter 105)
rm -f scripts/flipper-backend-bridge.ts

# KI-19 (iter 107): DELETE_* placeholder files are NOT valid TypeScript.
# A previous iteration created scripts/DELETE_flipper-backend-bridge.ts as
# a "note to delete this file" — but Next.js type-checks all .ts files and
# the build fails with "Unknown keyword or identifier. Did you mean 'delete'?".
# Delete any DELETE_*.ts files that may exist from previous iterations.
rm -f scripts/DELETE_*.ts
rm -f scripts/DELETE_*.tsx
rm -f src/**/DELETE_*.ts
rm -f src/**/DELETE_*.tsx

# Old iter archives (only latest archive kept)
rm -f MERGE_INSTRUCTIONS_iter101.md
rm -f MERGE_INSTRUCTIONS_iter102.md
rm -f MERGE_INSTRUCTIONS_iter103.md
rm -f MERGE_INSTRUCTIONS_iter105.md
rm -f MERGE_INSTRUCTIONS_iter106.md
rm -f git_commands_iter101.txt
rm -f git_commands_iter102.txt
rm -f git_commands_iter103.txt
rm -f git_commands_iter105.txt
rm -f git_commands_iter106.txt

# Runtime log (now gitignored)
rm -f flipper-bridge.log

# Old deletion scripts (iter 101-103)
rm -f DELETIONS.sh
rm -f DELETIONS.txt
rm -f README.txt

echo "Done. Obsolete files removed."
echo ""
echo "Next: extract iter107_archive.zip over this directory,"
echo "then run verification commands from MERGE_INSTRUCTIONS_iter107.md."

#!/bin/bash
# ============================================================
# Open-source release script
# - First release: orphan branch (no history)
# - Later: append to public repo (git pull)
# Usage: bash scripts/publish-opensource.sh
# ============================================================

set -e

echo ""
echo "Publishing open-source..."

# Ensure on main and clean
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Switch to main branch first"
  exit 1
fi

# Auto stash (including untracked), restore after
HAS_CHANGES=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Stashing uncommitted changes..."
  git stash -u
  HAS_CHANGES=true
fi

# Check if public repo already has history
echo "Checking public repo..."
git fetch public 2>/dev/null || true
PUBLIC_HAS_HISTORY=$(git ls-remote public main 2>/dev/null | wc -l | tr -d ' ')

if [ "$PUBLIC_HAS_HISTORY" = "0" ]; then
  # First release: orphan branch
  echo "First release: creating orphan branch..."
  git checkout --orphan release-public
  git add -A
else
  # Later: append to public history
  echo "Incremental release..."
  git checkout -b release-public public/main
  # Copy all files from main
  git checkout main -- .
  git add -A
fi

# Remove private content from commit
echo "Cleaning private content..."
git rm --cached .env -f 2>/dev/null || true
git rm -r --cached .github/workflows/ 2>/dev/null || true
git rm -r --cached .agent/ 2>/dev/null || true
git rm -r --cached .artifacts/ 2>/dev/null || true
git rm -r --cached .shared/ 2>/dev/null || true

# Update count (public commits + 1)
if [ "$PUBLIC_HAS_HISTORY" != "0" ]; then
  UPDATE_COUNT=$(git rev-list --count public/main 2>/dev/null || echo "0")
  UPDATE_COUNT=$((UPDATE_COUNT + 1))
else
  UPDATE_COUNT=1
fi

# Use CHANGELOG for commit message
CHANGELOG_FILE="CHANGELOG.md"
if [ -f "$CHANGELOG_FILE" ]; then
  # Extract version from first ## [vX.X]
  LATEST_VERSION=$(grep -m1 '^\#\# \[v' "$CHANGELOG_FILE" | sed 's/## \[\(.*\)\].*/\1/')
  # Extract changes for that version
  CHANGELOG_BODY=$(awk '/^## \[v/{if(found) exit; found=1; next} found' "$CHANGELOG_FILE" | sed '/^---$/d' | sed '/^$/d')
  COMMIT_MSG="release: ${LATEST_VERSION:-opensource} - Update #${UPDATE_COUNT}

${CHANGELOG_BODY}"
else
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  COMMIT_MSG="release: Update #${UPDATE_COUNT} - $TIMESTAMP"
fi

# Commit snapshot
git commit -m "$COMMIT_MSG" 2>/dev/null || {
  echo "Nothing to commit, already latest"
  git checkout -f main
  git branch -D release-public 2>/dev/null || true
  exit 0
}
echo "Snapshot commit created"
echo ""
echo "Commit content:"
echo "$COMMIT_MSG"

# Push to public repo (force on first, normal after)
echo "Pushing to public repo..."
if [ "$PUBLIC_HAS_HISTORY" = "0" ]; then
  git push public release-public:main --force
else
  git push public release-public:main
fi

echo ""
echo "=============================================="
echo "Open-source release done."
echo "🔗 https://github.com/waoowaooAI/waoowaoo"
echo "=============================================="
echo ""

# Back to main, remove temp branch
git checkout -f main
git branch -D release-public

echo "Back on main, temp branch removed"
echo ""

# Restore stashed changes
if [ "$HAS_CHANGES" = true ]; then
  echo "Restoring stashed changes..."
  git stash pop
fi

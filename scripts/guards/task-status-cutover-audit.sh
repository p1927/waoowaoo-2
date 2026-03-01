#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

FAILED=0

print_header() {
  echo
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

print_ok() {
  echo "[PASS] $1"
}

print_fail() {
  echo "[FAIL] $1"
}

run_zero_match_check() {
  local title="$1"
  local pattern="$2"
  shift 2
  local paths=("$@")
  local output
  output="$(git grep -n -E "$pattern" -- "${paths[@]}" || true)"
  if [[ -z "$output" ]]; then
    print_ok "$title"
  else
    print_fail "$title"
    echo "$output"
    FAILED=1
  fi
}

run_usetasktargetstates_check() {
  local title="useTaskTargetStates only in useProjectAssets/useGlobalAssets"
  local output
  output="$(git grep -n "useTaskTargetStates" -- src || true)"

  if [[ -z "$output" ]]; then
    print_ok "$title (0 hits)"
    return
  fi

  local filtered
  filtered="$(echo "$output" | grep -v "src/lib/query/hooks/useProjectAssets.ts" | grep -v "src/lib/query/hooks/useGlobalAssets.ts" || true)"

  if [[ -z "$filtered" ]]; then
    print_ok "$title"
  else
    print_fail "$title"
    echo "$filtered"
    FAILED=1
  fi
}

print_header "Task Status Cutover Audit"

run_zero_match_check \
  "useTaskHandoff forbidden" \
  "useTaskHandoff" \
  src

run_zero_match_check \
  "manualRegeneratingItems/setRegeneratingItems/clearRegeneratingItem forbidden" \
  "manualRegeneratingItems|setRegeneratingItems|clearRegeneratingItem" \
  src

run_zero_match_check \
  "No status ===/!== cancelled in app code" \
  "status\\s*===\\s*['\\\"]cancelled['\\\"]|status\\s*!==\\s*['\\\"]cancelled['\\\"]" \
  src

run_zero_match_check \
  "generatingImage/generatingVideo/generatingLipSync forbidden" \
  "\\bgeneratingImage\\b|\\bgeneratingVideo\\b|\\bgeneratingLipSync\\b" \
  src

run_usetasktargetstates_check

run_zero_match_check \
  "No useState(false) as generating state in novel-promotion/asset-hub/shared-assets" \
  "const \\[[^\\]]*(Generating|Regenerating|WaitingForGeneration|AnalyzingAssets|GeneratingAll|CopyingFromGlobal)[^\\]]*\\]\\s*=\\s*useState\\(false\\)" \
  "src/app/[locale]/workspace/[projectId]/modes/novel-promotion" \
  "src/app/[locale]/workspace/asset-hub" \
  "src/components/shared/assets"

print_header "Audit Result"
if [[ "$FAILED" -eq 0 ]]; then
  echo "All checks passed."
  exit 0
fi

echo "Audit failed. Please fix findings above."
exit 1

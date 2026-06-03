#!/usr/bin/env bash
# require-green-to-stop.sh — Stop AND SubagentStop
# Refuses to finish on a red bar when phase is green/refactor. A red bar in the
# red phase is correct (we just wrote a failing test), so allow it there.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
PHASE="$(cat "$ROOT/.claude/state/phase" 2>/dev/null || echo unknown)"
ST="$(cat "$ROOT/.claude/state/suite-status" 2>/dev/null || echo unknown)"
case "$PHASE" in
  green|refactor)
    if [ "$ST" = "red" ]; then
      echo "Cannot stop: phase=$PHASE but the suite is RED. Keep going until green (or revert the refactor). Do NOT edit tests to force green." >&2
      exit 2
    fi ;;
esac
exit 0

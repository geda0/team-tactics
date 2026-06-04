#!/usr/bin/env bash
# tic.sh — emit ONE tic (agent-to-agent communication unit). Not a wired hook; call from Bash:
#   .claude/hooks/tic.sh FROM TO KIND MSG [REF] [RESULT]
# Kinds: delegate handoff signal block verdict msg note claim release contract need.
# Read your inbox with:  tics inbox <role>   (or: tics log [--scope <s>])
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/.claude/hooks/lib.sh"
case "${3:-}" in
  delegate|handoff|signal|block|verdict|msg|note|claim|release|contract|need|"") ;;
  *) echo "tic.sh: warning — unknown kind '${3}' (known: delegate handoff signal block verdict msg note claim release contract need). Recording anyway — did you swap args? Usage: tic.sh FROM TO KIND MSG [REF] [RESULT]" >&2 ;;
esac
emit_tic "$@"

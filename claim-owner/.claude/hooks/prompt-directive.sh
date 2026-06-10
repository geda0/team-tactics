#!/usr/bin/env bash
# prompt-directive.sh — UserPromptSubmit hook (ADR 0005). Renews the standing operating directive on
# EVERY prompt so full-framework usage stays salient turn-over-turn — SessionStart fires once and a
# start-of-session NOTE was shown to fade (gvp: obeyed 0/2). stdout is added to the prompt context.
# Opt out with PROMPT_DIRECTIVE=0. REFRESHED on update; do NOT edit (local tweaks -> hooks/local.d/).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT/.claude/tdd.config" ] && . "$ROOT/.claude/tdd.config"
[ "${PROMPT_DIRECTIVE:-1}" = "1" ] || exit 0

printf '%s\n' "[team-tactics] Operate the FULL framework by default, scaled to the task (don't ceremony trivial asks — but reach for the team, not a solo edit, when the work is real):"
if [ -f "$ROOT/.claude/agents/product-owner.md" ]; then
  printf '%s\n' "- Outer loop: product-owner selects/accepts vs the brief, architect owns the §seams + ADRs, qa-verifier drives the running app, project-manager + dev-ops cut the release."
fi
printf '%s\n' "- Inner loop: set phase+layer, then delegate red->test-writer / green->implementer; tdd-critic every few cycles. The gate is the referee; the suite decides done, not you."
printf '%s\n' "- Coordinate through the tic bus (delegate/handoff/claim/need). Sharing the repo with peers? Join forces (\`tics todo\` / \`tics sessions\`) — don't work blind or double up."
exit 0

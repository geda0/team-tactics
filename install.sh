#!/usr/bin/env bash
# install.sh — install the TDD pairing kit into a target project.
#
#   ./install.sh [TARGET_DIR]        # default: current directory
#   ./install.sh --force [TARGET_DIR]# overwrite seeded (user-owned) files too
#
# Behavior:
#   • MECHANISM files (agents, hooks, method docs) are REFRESHED every run.
#   • SEEDED files (tdd.config, state/, project-invariants.md) are written ONCE
#     and never clobbered — they're yours. Use --force to reset them.
#   • Entry docs (AGENTS.md, CLAUDE.md, KICKOFF.md) install if absent; if you
#     already have one, the kit's version is written alongside as
#     <name>.tdd-pairing.md so you can merge.
#   • settings.json installs if absent; otherwise written as
#     settings.tdd-pairing.json for you to merge the hooks block.
set -euo pipefail

FORCE=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--force" ]; then FORCE=1; else ARGS+=("$a"); fi
done
TARGET="${ARGS[0]:-$(pwd)}"
SRC="$(cd "$(dirname "$0")/kit" && pwd)"

[ -d "$SRC" ] || { echo "error: kit payload not found at $SRC" >&2; exit 1; }
mkdir -p "$TARGET/.claude/agents" "$TARGET/.claude/hooks" "$TARGET/.claude/state" "$TARGET/docs/tdd"

say()  { printf '  %-9s %s\n' "$1" "$2"; }

refresh() { # always overwrite
  cp "$SRC/$1" "$TARGET/$1"; say "refresh" "$1";
}
seed_once() { # copy only if absent (unless --force)
  if [ -e "$TARGET/$1" ] && [ "$FORCE" -eq 0 ]; then say "keep" "$1 (exists)"; else cp "$SRC/$2" "$TARGET/$1"; say "seed" "$1"; fi
}
seed_or_sidecar() { # entry docs: install if absent, else drop a sidecar
  if [ -e "$TARGET/$1" ] && [ "$FORCE" -eq 0 ]; then
    side="${1%.md}.tdd-pairing.md"; cp "$SRC/$1" "$TARGET/$side"; say "sidecar" "$side (merge into your $1)"
  else cp "$SRC/$1" "$TARGET/$1"; say "install" "$1"; fi
}

echo "Installing TDD pairing kit -> $TARGET"

# 1) Mechanism — refreshed every run.
for f in agents/test-writer.md agents/implementer.md agents/tdd-critic.md agents/planner.md \
         hooks/guard-edit-scope.sh hooks/run-suite.sh hooks/require-green-to-stop.sh \
         hooks/session-green-check.sh; do
  cp "$SRC/claude-config/$f" "$TARGET/.claude/$f"; say "refresh" ".claude/$f"
done
chmod +x "$TARGET/.claude/hooks/"*.sh
for d in tdd-workflow testing-philosophy conventions; do
  cp "$SRC/docs/tdd/$d.md" "$TARGET/docs/tdd/$d.md"; say "refresh" "docs/tdd/$d.md"
done

# 2) Seeded — written once, never clobbered.
if [ -e "$TARGET/.claude/tdd.config" ] && [ "$FORCE" -eq 0 ]; then say "keep" ".claude/tdd.config (yours)"; else cp "$SRC/claude-config/tdd.config" "$TARGET/.claude/tdd.config"; say "seed" ".claude/tdd.config"; fi
for s in design-notes.md progress.md plan.md phase layer .gitkeep; do
  if [ -e "$TARGET/.claude/state/$s" ] && [ "$FORCE" -eq 0 ]; then say "keep" ".claude/state/$s"; else cp "$SRC/claude-config/state/$s" "$TARGET/.claude/state/$s"; say "seed" ".claude/state/$s"; fi
done
if [ -e "$TARGET/docs/tdd/project-invariants.md" ] && [ "$FORCE" -eq 0 ]; then say "keep" "docs/tdd/project-invariants.md (yours)"; else cp "$SRC/docs/tdd/project-invariants.template.md" "$TARGET/docs/tdd/project-invariants.md"; say "seed" "docs/tdd/project-invariants.md"; fi
if [ -e "$TARGET/.github/workflows/tdd-verify.yml" ] && [ "$FORCE" -eq 0 ]; then say "keep" ".github/workflows/tdd-verify.yml"; else mkdir -p "$TARGET/.github/workflows"; cp "$SRC/ci/tdd-verify.yml" "$TARGET/.github/workflows/tdd-verify.yml"; say "seed" ".github/workflows/tdd-verify.yml"; fi

# 3) settings.json — install or sidecar.
if [ -e "$TARGET/.claude/settings.json" ] && [ "$FORCE" -eq 0 ]; then
  cp "$SRC/claude-config/settings.json" "$TARGET/.claude/settings.tdd-pairing.json"
  say "sidecar" ".claude/settings.tdd-pairing.json (merge the hooks block)"
else
  cp "$SRC/claude-config/settings.json" "$TARGET/.claude/settings.json"; say "install" ".claude/settings.json"
fi

# 4) Entry docs.
seed_or_sidecar AGENTS.md
seed_or_sidecar CLAUDE.md
seed_or_sidecar KICKOFF.md

cat <<'NEXT'

Done. Next steps:
  1. Edit .claude/tdd.config — set LAYERS and the test command(s) for your stack.
  2. Fill in docs/tdd/project-invariants.md with rules your project must uphold.
  3. If a sidecar (*.tdd-pairing.*) was written, merge it into your existing file.
  4. Open the project in Claude Code and approve the hooks in settings.json.
  5. Run one dry red->green cycle with verbose output to watch the hooks fire.
  6. Start a feature: fill in KICKOFF.md and paste it to the orchestrator.

Confirm the gate works before relying on it: hook event names and exit-code
semantics shift between Claude Code releases (see code.claude.com/docs/en/hooks).
NEXT

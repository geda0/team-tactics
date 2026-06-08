#!/usr/bin/env bash
# release-tarball.sh — build the private peer-testing tarball (idempotent).
# Runs the full suite, packs from git tag v<version> when present, verifies payload.
#
# Usage (from repo root):
#   ./infra/release-tarball.sh [output.tgz]
#
# CI / release gate: set REQUIRE_TAG=1 so pack refuses unless v<version> exists and
# (optionally) matches TAG_NAME (e.g. GITHUB_REF_NAME).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
OUT="${1:-$ROOT/ttics-${VERSION}.tgz}"
REQUIRE_TAG="${REQUIRE_TAG:-0}"
TAG_NAME="${TAG_NAME:-}"

if [ "$REQUIRE_TAG" = "1" ]; then
  if ! git rev-parse --verify --quiet "v${VERSION}" >/dev/null; then
    echo "release-tarball: missing git tag v${VERSION} (cut tag after version bump)" >&2
    exit 1
  fi
  if [ -n "$TAG_NAME" ] && [ "$TAG_NAME" != "v${VERSION}" ]; then
    echo "release-tarball: tag ${TAG_NAME} does not match package.json version ${VERSION}" >&2
    exit 1
  fi
fi

echo "==> suite (ground truth)"
npm test

echo "==> pack ttics-${VERSION}.tgz"
node scripts/pack-tarball.js "$OUT"

echo "==> verify tarball payload"
REQUIRED=(
  FOR-TESTERS.md
  LICENSE
  package.json
  packages/team-tactics/bin/cli.js
  packages/tics/bin/tics.js
  packages/tdd/bin/tdd.js
)
LIST="$(tar -tzf "$OUT")"
for f in "${REQUIRED[@]}"; do
  if ! printf '%s\n' "$LIST" | grep -qx "$f"; then
    echo "release-tarball: missing required path in archive: $f" >&2
    exit 1
  fi
done

KB="$(du -k "$OUT" | awk '{print $1}')"
echo "OK: $OUT (${KB} KB) — send privately; see FOR-TESTERS.md"

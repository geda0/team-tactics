#!/usr/bin/env bash
# tics-lib.sh — the TIC PROTOCOL mechanism (emit_tic + the store). Method-agnostic coordination
# substrate; sourced by tic.sh and by tdd-pairing's lib.sh. REFRESHED on update; do NOT edit.
_tics_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
: "${ROOT:=$(cd "$_tics_lib_dir/../.." && pwd)}"
# shellcheck disable=SC1091
[ -f "$ROOT/.claude/tdd.config" ] && . "$ROOT/.claude/tdd.config"
: "${TICS:=1}"
: "${TIC_STORE:=jsonl}"
# Append one structured agent-to-agent communication unit. Store = .claude/state/tics.jsonl
# (append) or, with TIC_STORE=spool, one file per tic under .claude/state/tics.d/ (concurrency-safe).
# scope is ambient: TICS_SCOPE (per-call, for fan-out) else .claude/state/scope, else the active
# LAYER, else "*". TICS_DIR shares one spool across worktrees; TICS_FILE overrides the jsonl path.
# emit_tic FROM TO KIND MSG [REF] [RESULT] [EXTRA_JSON]
_tic_esc() { printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
emit_tic() {
  [ "${TICS:-1}" = "1" ] || return 0
  _tf="${TICS_FILE:-$ROOT/.claude/state/tics.jsonl}"
  _td="${TICS_DIR:-$ROOT/.claude/state/tics.d}"
  mkdir -p "$ROOT/.claude/state" 2>/dev/null || true
  [ "${TIC_STORE:-jsonl}" = "git" ] && { _tic_git_open; _td="$_gd/tics.d"; }
  _seq=$(( $({ cat "$_tf" 2>/dev/null; cat "$_td"/*.json 2>/dev/null; } | wc -l) + 1 ))
  _ph="$(cat "$ROOT/.claude/state/phase" 2>/dev/null || echo unknown)"
  _ly="$(cat "$ROOT/.claude/state/layer" 2>/dev/null || echo unknown)"
  _sc="${TICS_SCOPE:-$(cat "$ROOT/.claude/state/scope" 2>/dev/null)}"
  if [ -z "$_sc" ]; then
    if [ -n "$_ly" ] && [ "$_ly" != "unknown" ]; then _sc="$_ly"; else _sc="*"; fi
  fi
  # session identity (ADR 0002): which session emitted this tic — TICS_SESSION (per-process) else
  # .claude/state/session, else empty. Lets claims/commits tell which LIVE session owns what.
  _se="${TICS_SESSION:-$(cat "$ROOT/.claude/state/session" 2>/dev/null)}"
  if [ "${TIC_STORE:-jsonl}" = "git" ]; then
    mkdir -p "$_td" 2>/dev/null || true
    _out="$_td/$(date -u +%Y%m%dT%H%M%SZ)-${_se:-$(hostname -s 2>/dev/null || echo host)}-$$-${RANDOM:-0}.json"
  elif [ "${TIC_STORE:-jsonl}" = "spool" ]; then
    mkdir -p "$_td" 2>/dev/null || true
    _out="$_td/$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM:-0}.json"
  else
    _out="$_tf"
  fi
  printf '{"ts":"%s","seq":%s,"kind":"%s","from":"%s","to":"%s","phase":"%s","layer":"%s","scope":"%s","session":"%s","msg":"%s","ref":"%s","result":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_seq" \
    "$(_tic_esc "${3:-note}")" "$(_tic_esc "${1:-?}")" "$(_tic_esc "${2:-*}")" \
    "$(_tic_esc "$_ph")" "$(_tic_esc "$_ly")" "$(_tic_esc "$_sc")" "$(_tic_esc "$_se")" \
    "$(_tic_esc "${4:-}")" "$(_tic_esc "${5:-}")" "$(_tic_esc "${6:-}")" "${7:-}" \
    >> "$_out" 2>/dev/null || true
  [ "${TIC_STORE:-jsonl}" = "git" ] && _tic_git_publish "$_out"
  return 0
}

# TIC_STORE=git (ADR 0027): the bus is a branch (TICS_BRANCH, default tics-bus) of TICS_REMOTE, checked out in
# TICS_GIT_DIR (default .claude/state/tics.git), never the project's own tree. Each tic is one NEW spool file, so
# commits from different hosts touch disjoint paths: a rebase cannot conflict and a retried push loses nothing.
_tic_git() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX -u GIT_COMMON_DIR \
  git -C "$_gd" -c user.name=tics -c user.email=tics@localhost "$@"; }
_tic_git_open() {
  _gd="${TICS_GIT_DIR:-$ROOT/.claude/state/tics.git}"; _gb="${TICS_BRANCH:-tics-bus}"
  [ -d "$_gd/.git" ] && return 0
  mkdir -p "$_gd" 2>/dev/null || true
  _tic_git init -q 2>/dev/null
  _tic_git_hide
  _tic_git remote add origin "${TICS_REMOTE:-}" 2>/dev/null
  if _tic_git fetch -q origin "$_gb" 2>/dev/null; then _tic_git checkout -q -B "$_gb" FETCH_HEAD 2>/dev/null
  else _tic_git checkout -q --orphan "$_gb" 2>/dev/null; fi
}
# P5: when the bus checkout sits inside the project's own git tree, list it in the project's info/exclude
# (never a tracked .gitignore), so emits leave the project's status and HEAD untouched.
_tic_git_hide() {
  case "$_gd" in "$ROOT"/*) ;; *) return 0 ;; esac
  _tic_git_proj() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX -u GIT_COMMON_DIR git -C "$ROOT" "$@"; }
  _pp="$(_tic_git_proj rev-parse --show-prefix 2>/dev/null)" || return 0
  _ex="$(_tic_git_proj rev-parse --git-path info/exclude 2>/dev/null)" || return 0
  case "$_ex" in /*) ;; *) _ex="$ROOT/$_ex" ;; esac
  _rel="/$_pp${_gd#"$ROOT"/}/"
  mkdir -p "$(dirname "$_ex")" 2>/dev/null || true
  grep -qxF "$_rel" "$_ex" 2>/dev/null || printf '%s\n' "$_rel" >> "$_ex" 2>/dev/null || true
}
# Commit the one new tic file, then push; on a rejected push fetch + rebase + retry (bounded, jittered).
# If every try fails the tic stays committed locally and rides out with the next emit's push.
_tic_git_publish() {
  _tic_git add -- "${1#"$_gd"/}" 2>/dev/null && _tic_git commit -q -m "tic" 2>/dev/null || return 0
  _n=0
  until _tic_git push -q origin "HEAD:refs/heads/$_gb" 2>/dev/null; do
    _n=$((_n + 1)); [ "$_n" -ge "${TICS_PUSH_TRIES:-8}" ] && return 0
    _tic_git fetch -q origin "$_gb" 2>/dev/null && _tic_git rebase -q FETCH_HEAD >/dev/null 2>&1
    sleep "0.$(( (RANDOM % 4) + 1 ))"
  done
  return 0
}

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

# TIC_STORE=git (ADR 0026): the bus is a branch (TICS_BRANCH, default tics-bus) of TICS_REMOTE, checked out in
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
  # P3 local first: no fetch here. The tic is committed before any network call; a remote bus branch is
  # integrated by the push's non-fast-forward retry (rebase), and the reader unions the tracking tree.
  _tic_git checkout -q --orphan "$_gb" 2>/dev/null
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
# Commit the new tic file, then publish it (P3: bounded, never hangs, never drops the tic). Emits sharing one
# checkout serialize on a per-checkout lock (git's index.lock would otherwise make a concurrent add/commit fail and
# strand the file), and each stages all of tics.d, so a file left uncommitted by an earlier emit rides with this one.
# If the lock can't be had within the bound, the file stays in the worktree for the next emit or `tics sync`.
_tic_git_publish() {
  _tic_git_lock || return 0
  _tic_git add -- tics.d 2>/dev/null
  if _tic_git diff --cached --quiet 2>/dev/null || ! _tic_git commit -q -m "tic" 2>/dev/null; then
    _tic_git_unlock; return 0   # nothing new: a concurrent emit already committed (and published) this file
  fi
  _tic_net_backoff || _tic_git_push || true
  _tic_git_unlock
  return 0
}
# Portable per-checkout mutex (macOS has no flock(1)): mkdir is atomic. The holder's pid is recorded, so a lock
# left by a killed emit is reclaimed at once. Waits at most TICS_LOCK_WAIT seconds (default 3 x TICS_NET_TIMEOUT).
_tic_git_lock() {
  _lk="$_gd/.git/tics-emit.lock"
  _lw=$(( ${TICS_LOCK_WAIT:-$(( 3 * ${TICS_NET_TIMEOUT:-5} ))} * 20 ))
  while ! mkdir "$_lk" 2>/dev/null; do
    _lp="$(cat "$_lk/pid" 2>/dev/null)"
    if [ -n "$_lp" ] && ! kill -0 "$_lp" 2>/dev/null; then rm -rf "$_lk" 2>/dev/null; continue; fi
    _lw=$((_lw - 1)); [ "$_lw" -gt 0 ] || return 1
    sleep 0.05
  done
  echo "$$" > "$_lk/pid" 2>/dev/null
  return 0
}
_tic_git_unlock() { rm -rf "$_gd/.git/tics-emit.lock" 2>/dev/null; return 0; }
# Push HEAD to the bus branch. Only a non-fast-forward rejection is retried (fetch + rebase + push, bounded by
# TICS_PUSH_TRIES, jittered); a timeout or network error is not, and records the failure (attempt stamp +
# fail marker) so emits and reads inside TICS_FETCH_TTL skip the network. Unpublished tics stay committed
# locally and ride out with the next push or `tics sync`. Returns 0 when published.
_tic_git_push() {
  _n=0
  while :; do
    _tic_net push origin "HEAD:refs/heads/$_gb"; _rc=$?
    [ "$_rc" -eq 0 ] && { _tic_net_ok; return 0; }
    [ "$_rc" -eq 2 ] || { _tic_net_fail; return 1; }
    _n=$((_n + 1)); [ "$_n" -ge "${TICS_PUSH_TRIES:-8}" ] && return 1
    _tic_net fetch -q origin "$_gb" || { _tic_net_fail; return 1; }
    _tic_git rebase -q FETCH_HEAD >/dev/null 2>&1 || _tic_git rebase --abort >/dev/null 2>&1
    sleep "0.$(( (RANDOM % 4) + 1 ))"
  done
}
# Run one networked git command under a watchdog: TICS_NET_TIMEOUT seconds (default 5), pure bash (macOS has no
# timeout(1)). git and the sleeper each run in their own process group (set -m), so expiry kills git with its
# ssh/helper children, and a git that finishes first takes the sleeper down with it. Nothing is left running.
# Returns 0 ok, 2 rejected (non-fast-forward or a lost ref race), 1 timeout or any other failure.
_tic_net() {
  _ne="$_gd/.git/tics-net.$$.err"; _om=; case $- in *m*) _om=1 ;; esac
  {
    set -m
    GIT_TERMINAL_PROMPT=0 _tic_git "$@" >/dev/null 2>"$_ne" </dev/null & _np=$!
    ( sleep "${TICS_NET_TIMEOUT:-5}"; kill -KILL -- -"$_np" ) </dev/null >/dev/null 2>&1 & _wp=$!
    wait "$_np"; _nrc=$?
    kill -KILL -- -"$_wp"; wait "$_wp"
    [ -n "$_om" ] || set +m
  } 2>/dev/null
  _nrc2=1
  # a lost race on the remote ref (another emitter updated it mid-push) is a rejection too, not a network error
  if [ "$_nrc" -eq 0 ]; then _nrc2=0
  elif grep -qE '\[rejected\]|non-fast-forward|fetch first|cannot lock ref|failed to update ref' "$_ne" 2>/dev/null; then _nrc2=2
  elif grep -qE "couldn't find remote ref" "$_ne" 2>/dev/null; then _nrc2=3   # reachable, no bus branch yet
  fi
  rm -f "$_ne" 2>/dev/null
  return "$_nrc2"
}
# The reader's fetch (tics-view.cjs, ADR 0026): refresh origin/<branch> in the bus at BUS_DIR under the same
# watchdog as the writer, so a hanging transport helper is killed with git. tics_fetch BUS_DIR BRANCH; returns
# _tic_net's code. It keeps the one shared failure record (rule 4): a failed fetch marks it, so emits inside the
# TTL skip the network too (the reader keeps its own attempt stamp); a successful one clears it. A reachable remote with no bus branch yet clears the
# fail marker but never sets the success stamp.
tics_fetch() {
  _gd="$1"; _gb="$2"
  _tic_net -c gc.auto=0 -c maintenance.auto=false fetch -q origin "+$_gb:refs/remotes/origin/$_gb"; _frc=$?
  case "$_frc" in
    0) _tic_net_ok ;;
    3) rm -f "$_gd/.git/tics-net-failed" 2>/dev/null ;;
    *) _tic_net_mark ;;   # the reader already wrote its own attempt stamp
  esac
  return "$_frc"
}
# The network-failure record, shared with the reader (tics-view.cjs gitStore): the attempt stamp drives the
# reader's fetch TTL; the fail marker (epoch seconds) tells emits the last attempt failed.
_tic_net_fail() {
  date -u +%Y-%m-%dT%H:%M:%SZ > "$_gd/.git/tics-fetch-attempt" 2>/dev/null
  _tic_net_mark
}
_tic_net_mark() { date +%s > "$_gd/.git/tics-net-failed" 2>/dev/null; return 0; }
# A successful push leaves origin/<branch> equal to what was pushed, so it also refreshes the success stamp.
_tic_net_ok() {
  rm -f "$_gd/.git/tics-net-failed" 2>/dev/null
  date -u +%Y-%m-%dT%H:%M:%SZ > "$_gd/.git/tics-fetch-stamp" 2>/dev/null
  return 0
}
# True (skip the network) when the last attempt failed less than TICS_FETCH_TTL seconds ago (default 60).
_tic_net_backoff() {
  _nf="$(cat "$_gd/.git/tics-net-failed" 2>/dev/null)"
  case "$_nf" in '' | *[!0-9]*) return 1 ;; esac
  [ $(( $(date +%s) - _nf )) -lt "${TICS_FETCH_TTL:-60}" ]
}
# `tics sync` (ADR 0026 P3): publish every unpushed local tic, ignoring the TTL (an explicit request), then
# refresh the remote-tracking ref for the reader. Idempotent; always returns 0.
tics_sync() {
  [ "${TIC_STORE:-jsonl}" = "git" ] || { echo "tics sync: TIC_STORE is not git; nothing to publish"; return 0; }
  _tic_git_open
  # the same per-checkout lock as an emit, so a sync never races an emit's add/commit/push on this checkout
  _tic_git_lock || { echo "tics sync: the bus checkout is busy; retry shortly"; return 0; }
  if [ -d "$_gd/tics.d" ]; then
    _tic_git add -- tics.d 2>/dev/null
    _tic_git diff --cached --quiet 2>/dev/null || _tic_git commit -q -m "tic" 2>/dev/null
  fi
  _tic_git rev-parse -q --verify HEAD >/dev/null 2>&1 || { _tic_git_unlock; echo "tics sync: no local tics"; return 0; }
  if ! _tic_git_push; then _tic_git_unlock; echo "tics sync: remote unreachable; local tics kept, retry later"; return 0; fi
  _tic_git_unlock
  date -u +%Y-%m-%dT%H:%M:%SZ > "$_gd/.git/tics-fetch-attempt" 2>/dev/null
  _tic_net fetch -q origin "+$_gb:refs/remotes/origin/$_gb" && _tic_net_ok
  echo "tics sync: published to origin/$_gb"
  return 0
}

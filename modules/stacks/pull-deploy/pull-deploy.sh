# pull-deploy: apply the deploy branch to this host (./default.nix prepends
# repository, branch, main_branch, attribute, people, state, and sources
# scripts/lib/deploy-guard.sh and scripts/lib/post-switch.sh).
#
#   pull-deploy status          what the host runs, what deploy points at
#   pull-deploy pause [reason]  stop applying (root); survives reboots
#   pull-deploy resume          apply again (root)
#   pull-deploy now             forget a failure and poll at once (root)
#   pull-deploy poll | apply    what the units run

repo="$state/repo"

log() { echo "pull-deploy: $*" >&2; }

need_root() {
  if [[ "$(id -u)" != 0 ]]; then
    echo "pull-deploy: $1 needs root: sudo pull-deploy $1" >&2
    exit 1
  fi
}

git_repo() { git -C "$repo" -c safe.directory='*' "$@"; }

# The deploy and main heads into $repo (a plain checkout, so the flake's
# self.rev is the commit built). main is optional: only to know commits a
# manual rebuild put on the host.
fetch() {
  if [[ ! -d "$repo/.git" ]]; then
    git init --quiet "$repo"
  fi
  git_repo fetch --quiet --no-tags "$repository" \
    "+refs/heads/$branch:refs/remotes/origin/$branch" || return 1
  git_repo fetch --quiet --no-tags "$repository" \
    "+refs/heads/$main_branch:refs/remotes/origin/$main_branch" 2>/dev/null || true
  date --iso-8601=seconds >"$state/fetched-at"
}

deploy_tip() { git_repo rev-parse --verify --quiet "refs/remotes/origin/$branch^{commit}"; }

failed_tip() { cut -d' ' -f1 "$state/failed" 2>/dev/null || true; }

# Forget a failure: the host caught up some other way, or a newer commit
# went through.
clear_failure() {
  rm -f "$state/failed"
  systemctl reset-failed pull-deploy.service 2>/dev/null || true
}

# Record why <tip> was not applied and fail the unit; the poll does not
# start the apply again for that commit.
fail() {
  printf '%s %s\n' "$1" "$2" >"$state/failed"
  log "FAILED: $2"
  exit 1
}

cmd_poll() {
  if [[ -e "$state/paused" ]]; then
    exit 0
  fi
  # GAP [[01M89TBG2GTS2ACABN4C68FZKB]]: a fetch failing for long fails no unit.
  if ! fetch; then
    log "could not fetch $branch from $repository; trying again at the next poll."
    exit 0
  fi
  local tip applied relation
  tip="$(deploy_tip)" || {
    log "$repository has no $branch branch yet."
    exit 0
  }
  applied="$(dotfiles_applied_revision)"
  relation="$(dotfiles_revision_relation "$repo" "$applied" "$tip")"
  case "$relation" in
    equal | behind)
      if [[ -e "$state/failed" ]]; then
        log "the host runs $applied, which includes $branch ($tip); clearing the earlier failure."
        clear_failure
      fi
      ;;
    *)
      if [[ "$(failed_tip)" == "$tip" ]]; then
        exit 0
      fi
      log "$branch is at $tip, the host runs ${applied:-no recorded revision} ($relation); starting pull-deploy.service."
      systemctl start --no-block pull-deploy.service
      ;;
  esac
}

# Decide what to do with <tip> against what the host runs now: returns 0
# only for a forward switch; exits otherwise.
decide() {
  local tip="$1" applied relation
  applied="$(dotfiles_applied_revision)"
  relation="$(dotfiles_revision_relation "$repo" "$applied" "$tip")"
  case "$relation" in
    forward) return 0 ;;
    equal)
      log "the host already runs $tip."
      clear_failure
      exit 0
      ;;
    behind)
      log "skipped $tip: the host runs $applied, which descends from it (a rebuild from $main_branch got ahead). Never rolling back."
      clear_failure
      exit 0
      ;;
    *)
      fail "$tip" "holding at ${applied:-a system with no recorded revision}: it is not an ancestor of $branch ($tip), so it was applied by hand from outside $main_branch, and switching could undo it. Run rebuild from origin/main, or wait for $branch to include it; then pull-deploy now."
      ;;
  esac
}

cmd_apply() {
  if [[ -e "$state/paused" ]]; then
    log "paused ($(cat "$state/paused")); not applying. Resume: sudo pull-deploy resume"
    exit 0
  fi
  fetch || {
    log "FAILED: could not fetch $branch from $repository."
    exit 1
  }
  local tip out applied built rc
  tip="$(deploy_tip)"
  decide "$tip"
  applied="$(dotfiles_applied_revision)"

  git_repo checkout --quiet --detach --force "$tip"
  log "building $tip (the host runs $applied)."
  out="$(nix build --no-link --print-out-paths --no-write-lock-file "git+file://$repo#$attribute")" ||
    fail "$tip" "the build of $tip failed; the host stays on $applied. The log is above (journalctl -u pull-deploy)."
  built="$(DOTFILES_CURRENT_SYSTEM="$out" dotfiles_applied_revision)"
  if [[ "$built" != "$tip" ]]; then
    fail "$tip" "the system built from $tip records revision '${built}'; not switching."
  fi

  # Hold the lock rebuild also holds, then decide again: a rebuild may have
  # switched the host while this one built.
  exec 9>>"$(dotfiles_apply_lock)"
  if ! flock -n 9; then
    log "waiting for another apply (a rebuild) to finish."
    flock 9
  fi
  decide "$tip"

  nix-env --profile /nix/var/nix/profiles/system --set "$out" ||
    fail "$tip" "could not set the system profile to $out; the host stays on $applied."
  rc=0
  "$out/bin/switch-to-configuration" switch || rc=$?

  # The applied generation's own tools (restart-app among them).
  export PATH="$PATH:/run/current-system/sw/bin"
  dotfiles_post_switch "${people[@]}"

  if ((rc != 0)); then
    fail "$tip" "switching to $tip exited $rc: the host runs it, but some units did not start (systemctl --failed)."
  fi
  clear_failure
  log "applied $tip."
}

cmd_status() {
  local applied tip main relation
  applied="$(dotfiles_applied_revision)"
  echo "applied:   ${applied:-none recorded} (/run/current-system/configuration-revision)"
  if tip="$(deploy_tip 2>/dev/null)"; then
    relation="$(dotfiles_revision_relation "$repo" "$applied" "$tip")"
    echo "$branch:    $tip (fetched $(cat "$state/fetched-at" 2>/dev/null || echo never); switching to it: $relation)"
  else
    echo "$branch:    not fetched yet"
  fi
  if main="$(git_repo rev-parse --verify --quiet "refs/remotes/origin/$main_branch^{commit}" 2>/dev/null)"; then
    echo "$main_branch:      $main (switching to it: $(dotfiles_revision_relation "$repo" "$applied" "$main"))"
  fi
  if [[ -e "$state/paused" ]]; then
    echo "mode:      paused since $(cat "$state/paused"); resume: sudo pull-deploy resume"
  else
    echo "mode:      automatic (every poll; pause: sudo pull-deploy pause <reason>)"
  fi
  if [[ -e "$state/failed" ]]; then
    echo "failed:    $(cat "$state/failed")"
    echo "           retry: sudo pull-deploy now; log: journalctl -u pull-deploy"
  fi
  echo "units:     pull-deploy.service $(systemctl is-active pull-deploy.service 2>/dev/null || true), pull-deploy-poll.timer $(systemctl is-active pull-deploy-poll.timer 2>/dev/null || true)"
}

case "${1:-}" in
  poll) cmd_poll ;;
  apply) cmd_apply ;;
  status) cmd_status ;;
  pause)
    need_root pause
    shift
    mkdir -p "$state"
    printf '%s by %s: %s\n' "$(date --iso-8601=seconds)" "${SUDO_USER:-root}" "${*:-no reason given}" >"$state/paused"
    log "paused by ${SUDO_USER:-root}: ${*:-no reason given}. Resume: sudo pull-deploy resume"
    ;;
  resume)
    need_root resume
    rm -f "$state/paused"
    log "resumed by ${SUDO_USER:-root}; polling now."
    systemctl start --no-block pull-deploy-poll.service
    ;;
  now)
    need_root now
    if [[ -e "$state/paused" ]]; then
      echo "pull-deploy: paused ($(cat "$state/paused")); resume first: sudo pull-deploy resume" >&2
      exit 1
    fi
    clear_failure
    systemctl start pull-deploy-poll.service
    echo "pull-deploy: polled; follow the apply with: journalctl -fu pull-deploy"
    ;;
  *)
    echo "usage: pull-deploy status | pause [reason] | resume | now" >&2
    exit 2
    ;;
esac

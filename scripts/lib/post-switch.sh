# shellcheck shell=bash
# What follows every switch of this repository, however it was applied:
# `rebuild` (scripts/rebuild, any platform) and the pull agent
# (modules/stacks/pull-deploy, NixOS). One home, so the two never drift.
# Every step is best effort, as in activation: a switch that went through
# is not undone by a step after it.

# Runs a command as root: directly when already root (the agent), else
# through sudo (rebuild, run by a person).
dotfiles_as_root() {
  if [[ "$(id -u)" == 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# dotfiles_post_switch <person>...: the steps, with the people whose bb
# plugins to converge (rebuild: who runs it; the agent: everyone on the host).
dotfiles_post_switch() {
  local person sync home

  # Converge bb plugins to their source in the generation just applied (the
  # plugin folders are in its closure). Home Manager activation runs the
  # same installer, but only when the generation changes: a sync activation
  # skipped (no bb server answering) or an interrupted activation would
  # otherwise stay stale. Unchanged plugins are skipped by store hash. It
  # reaches only that person's own bb, run as them with their home.
  for person in "$@"; do
    sync="/etc/profiles/per-user/$person/bin/bb-plugins-sync"
    [[ -x "$sync" ]] || continue
    if [[ "$(id -un)" == "$person" ]]; then
      "$sync" || echo "post-switch: bb-plugins-sync failed for $person; rerun it by hand." >&2
    else
      home="$(getent passwd "$person" | cut -d: -f6)"
      dotfiles_as_root runuser -u "$person" -- env HOME="$home" "$sync" ||
        echo "post-switch: bb-plugins-sync failed for $person; they can rerun it by hand." >&2
    fi
  done

  [[ "$(uname -s)" == Linux ]] || return 0

  # Rerun the Tailscale Services reconcile, which re-advertises every
  # declared Service, even when the switch left the job alone. A host
  # advertising a new Service is approved only if, at that moment, the
  # Service exists and the policy auto-approves it, and both come from CI
  # after the push (tailscale-reconcile.yml: Services, then policy). A host
  # that advertised before CI finished is never approved later, so it stays
  # unreachable; rerunning this once CI is done fixes it. The pull agent
  # applies only commits whose CI is done (docs/deploys.md).
  if systemctl cat tailscale-services.service >/dev/null 2>&1; then
    dotfiles_as_root systemctl restart tailscale-services.service ||
      echo "post-switch: restarting tailscale-services.service failed; see journalctl -u tailscale-services." >&2
  fi

  # my.services restarts still pending (an app waiting for idle), companions
  # not running beside their app, and waiters that gave up.
  if command -v restart-app >/dev/null; then
    restart-app --status || true
  fi
}

# shellcheck shell=bash
# The rule both ways of applying this repository to a shared NixOS host obey:
# `rebuild` (scripts/rebuild) and the pull agent (modules/stacks/pull-deploy).
# Neither may switch the host to a commit that is not a descendant of what
# it runs now, so neither rolls back what the other, or another person,
# applied. Sourced from the checkout by rebuild and from the applied
# revision's store copy by the agent: one file, one rule (docs/deploys.md).

# Both hold this lock from their last check to the end of the switch, so the
# one that waits decides against what the other applied. Declared by
# modules/nixos/system/applying.nix (a root file every account may open read-only:
# flock needs no write access).
dotfiles_apply_lock() { echo /run/dotfiles-apply.lock; }

# dotfiles_applied_revision: the commit the running system was built from,
# written into the system by modules/nixos/system/applying.nix from
# my.revision (flake.nix sets it to the flake's rev, or `<rev>-dirty` for a
# tree with uncommitted changes). Prints nothing for a
# system built before the file existed. DOTFILES_CURRENT_SYSTEM overrides
# /run/current-system, for tests.
dotfiles_applied_revision() {
  local file="${DOTFILES_CURRENT_SYSTEM:-/run/current-system}/configuration-revision"
  if [[ -r "$file" ]]; then
    tr -d '[:space:]' <"$file"
  fi
}

# dotfiles_revision_relation <git dir> <applied> <target>: where switching
# from <applied> to <target> goes, one word:
#   equal     the same commit;
#   forward   <target> descends from <applied>: the only switch allowed;
#   behind    <target> is an ancestor of <applied>: a rollback;
#   diverged  both are known commits and neither descends from the other;
#   unknown   <applied> is empty, dirty, or a commit <git dir> lacks.
dotfiles_revision_relation() {
  local git_dir="$1" applied="$2" target="$3"
  if [[ -z "$applied" || "$applied" == *dirty* ]] ||
    ! git -C "$git_dir" -c safe.directory='*' cat-file -e "${applied}^{commit}" 2>/dev/null; then
    echo unknown
    return 0
  fi
  applied="$(git -C "$git_dir" -c safe.directory='*' rev-parse "${applied}^{commit}")"
  target="$(git -C "$git_dir" -c safe.directory='*' rev-parse "${target}^{commit}")"
  if [[ "$applied" == "$target" ]]; then
    echo equal
  elif git -C "$git_dir" -c safe.directory='*' merge-base --is-ancestor "$applied" "$target"; then
    echo forward
  elif git -C "$git_dir" -c safe.directory='*' merge-base --is-ancestor "$target" "$applied"; then
    echo behind
  else
    echo diverged
  fi
}

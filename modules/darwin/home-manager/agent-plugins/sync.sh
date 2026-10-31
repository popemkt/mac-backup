# agent-plugins-sync: point the agents at this repo's own plugin folders (a
# marketplace a stack declares as "<name>=./<folder>", today
# dotfiles=./assets/plugins) as the revision applied has them. ./default.nix
# prepends: home, folders (an array of <name>=<store copy of the folder>),
# state (this sync's state directory), legacy (where the checkout-based
# script it replaced linked from), cu (coreutils' bin), flock and jq by
# absolute path, since activation inherits no PATH worth trusting, and warn
# and lock_state (plugin-sources/sync-lib.sh).
#
# Everything an agent reads from a folder goes through one stable link,
# $state/<name>: Claude Code's marketplace <name> is registered there (it
# reads a folder marketplace's plugins in place, so the path must not move
# with every revision), each plugin's skills are linked through it into
# ~/.agents/skills and from there into Claude Code's, Codex's and Cursor's
# skill folders, and Oh My Pi links its plugins through it. Renaming one new
# link over it switches all of them at once. A store copy needs no writable
# copy, unlike bb's: these agents only read the folder.
#
# By default the link names the store copy, so agents read the revision
# applied. `agent-plugins-sync --path <dir>` points the link of the
# marketplace <dir> holds (its .claude-plugin/marketplace.json name) at that
# folder instead, read in place, so an edit to a skill or a Claude Code
# plugin in a checkout reaches a session at once (/reload-plugins); the next
# plain sync, which every rebuild runs, points it back.
#
# Best effort: whatever fails warns, exits 0 and leaves what agents read now.

try_name=""
try_dir=""
case "${1:-}" in
  "") ;;
  --path)
    if [ -z "${2:-}" ] || [ ! -f "$2/.claude-plugin/marketplace.json" ]; then
      echo "agent-plugins-sync: --path needs a plugins folder with .claude-plugin/marketplace.json, such as <worktree>/assets/plugins" >&2
      exit 2
    fi
    try_dir="$(cd "$2" && pwd)"
    try_name="$("$jq" -r '.name // ""' "$try_dir/.claude-plugin/marketplace.json")" || try_name=""
    declared=false
    for entry in "${folders[@]}"; do
      [ "${entry%%=*}" = "$try_name" ] && declared=true
    done
    if ! $declared; then
      echo "agent-plugins-sync: $try_dir holds marketplace \"$try_name\", which no stack declares from a repo folder" >&2
      exit 2
    fi
    ;;
  *)
    echo "usage: agent-plugins-sync [--path <plugins-dir>]" >&2
    exit 2
    ;;
esac

lock_state "$state" "the agents' plugins from this repo" || exit 0

# link <path> <target>: make <path> a link to <target>, unless something that
# is no link is there (a person's own skill of the same name).
link() {
  if [ -e "$1" ] && [ ! -L "$1" ]; then
    warn "$1 is not a link; left it alone, so this repo's skill is not linked there"
    return 0
  fi
  [ "$("$cu/readlink" "$1" 2>/dev/null || true)" = "$2" ] && return 0
  "$cu/ln" -sfn "$2" "$1" || warn "cannot link $1"
}

shared="$home/.agents/skills"
agents=("$home/.claude/skills" "$home/.codex/skills" "$home/.cursor/skills-cursor")
if ! "$cu/mkdir" -p "$shared" "${agents[@]}"; then
  warn "cannot create the agents' skill folders; skipped this repo's plugins"
  exit 0
fi

omp=""
for candidate in "$(command -v omp 2>/dev/null || true)" "$home/.bun/bin/omp"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    omp="$candidate"
    break
  fi
done

names=()
for entry in "${folders[@]}"; do
  name="${entry%%=*}"
  target="${entry#*=}"
  [ "$name" = "$try_name" ] && target="$try_dir"
  names+=("$name")
  stable="$state/$name"

  previous="$("$cu/readlink" "$stable" 2>/dev/null || true)"
  if [ "$previous" != "$target" ]; then
    if ! { "$cu/ln" -sfn "$target" "$state/.$name.new" && "$cu/mv" -Tf "$state/.$name.new" "$stable"; }; then
      warn "cannot point $stable at $target; agents keep ${previous:-nothing}"
      continue
    fi
    echo "Agent plugins and skills of $name: $target"
  fi

  # Every skill of every plugin: ~/.agents/skills/<skill> through the stable
  # link, and each agent's folder to that.
  for skill in "$target"/*/skills/*/; do
    [ -d "$skill" ] || continue
    rel="${skill#"$target"/}"
    rel="${rel%/}"
    skill="${rel##*/}"
    link "$shared/$skill" "$stable/$rel"
    for dir in "${agents[@]}"; do
      link "$dir/$skill" "$shared/$skill"
    done
  done

  # Oh My Pi loads a plugin through its own link to it; relinked every sync,
  # since it is cheap and omp may have been installed since the last one.
  if [ -n "$omp" ]; then
    for plugin in "$target"/*/package.json; do
      [ -f "$plugin" ] || continue
      plugin="${plugin%/package.json}"
      plugin="$stable/${plugin##*/}"
      # omp is `#!/usr/bin/env bun`.
      PATH="$home/.bun/bin:$PATH" "$omp" plugin link "$plugin" >/dev/null 2>&1 \
        || warn "omp plugin link $plugin failed"
    done
  fi
done

# A stable link no stack declares any more goes, so its skills' links
# dangle and go below.
for stable in "$state"/*; do
  [ -L "$stable" ] || continue
  keep=false
  for name in "${names[@]}"; do
    [ "$stable" = "$state/$name" ] && keep=true
  done
  $keep || "$cu/rm" -f "$stable" || true
done

# Links this sync made for a skill a folder no longer has (they dangle), or
# the checkout-based script made (they point into $legacy): removed, with
# each agent's link to them.
for entry in "$shared"/*; do
  [ -L "$entry" ] || continue
  dest="$("$cu/readlink" "$entry")" || continue
  case "$dest" in
    "$state"/*) [ -e "$entry" ] && continue ;;
    "$legacy"/*) ;;
    *) continue ;;
  esac
  skill="${entry##*/}"
  "$cu/rm" -f "$entry" || continue
  for dir in "${agents[@]}"; do
    if [ "$("$cu/readlink" "$dir/$skill" 2>/dev/null || true)" = "$entry" ]; then
      "$cu/rm" -f "$dir/$skill" || true
    fi
  done
  echo "Unlinked skill: $skill"
done
exit 0

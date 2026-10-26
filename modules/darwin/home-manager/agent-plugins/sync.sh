# agent-plugins-sync: point the agents at this repo's own plugins and skills
# (assets/plugins) as the revision applied has them. ./default.nix prepends:
# home, source (the store copy of assets/plugins), state (this sync's state
# directory), legacy (where the checkout-based script it replaced linked
# from), and cu (coreutils' bin) and flock by absolute path, since activation
# inherits no PATH worth trusting.
#
# Everything an agent reads from the folder goes through one stable link,
# $state/current: Claude Code's `dotfiles` marketplace is registered there
# (Claude Code reads a folder marketplace's plugins in place, so the path
# must not move with every revision), each plugin's skills are linked through
# it into ~/.agents/skills and from there into Claude Code's, Codex's and
# Cursor's skill folders, and Oh My Pi links its plugins through it.
# Switching the link switches all of them at once.
#
# By default the link names the store copy, so agents read the revision
# applied. `agent-plugins-sync --path <dir>` points it at a checkout's
# assets/plugins instead, read in place, so an edit to a skill or a Claude
# Code plugin reaches a session at once (/reload-plugins); the next plain
# sync, which every rebuild runs, points it back.
#
# Best effort: this runs inside Home Manager activation, which must never
# abort over an agent plugin. Whatever fails warns, exits 0 and leaves what
# agents read now.

warn() { echo "warning: $*" >&2; }

target="$source"
case "${1:-}" in
  "") ;;
  --path)
    if [ -z "${2:-}" ] || [ ! -f "$2/.claude-plugin/marketplace.json" ]; then
      echo "agent-plugins-sync: --path needs a plugins folder with .claude-plugin/marketplace.json, such as <worktree>/assets/plugins" >&2
      exit 2
    fi
    target="$(cd "$2" && pwd)"
    ;;
  *)
    echo "usage: agent-plugins-sync [--path <plugins-dir>]" >&2
    exit 2
    ;;
esac

if ! "$cu/mkdir" -p "$state"; then
  warn "cannot create $state; agents keep the plugins they read now"
  exit 0
fi
# One sync at a time: activation and a person's own run can overlap.
if ! exec 9>>"$state/.lock"; then
  warn "cannot open $state/.lock; agents keep the plugins they read now"
  exit 0
fi
if ! "$flock" -w 300 9; then
  warn "another agent-plugins-sync held $state/.lock for 5 minutes; skipped"
  exit 0
fi

current="$state/current"
previous="$("$cu/readlink" "$current" 2>/dev/null || true)"
if [ "$previous" != "$target" ]; then
  # A new link renamed over the old one: agents never see the link missing.
  if ! { "$cu/ln" -sfn "$target" "$state/.current.new" && "$cu/mv" -Tf "$state/.current.new" "$current"; }; then
    warn "cannot point $current at $target; agents keep ${previous:-nothing}"
    exit 0
  fi
  echo "Agent plugins and skills: $target"
fi

# link <path> <target>: make <path> a link to <target>, unless something that
# is no link is there (a person's own skill of the same name).
link() {
  if [ -e "$1" ] && [ ! -L "$1" ]; then
    warn "$1 is not a link; left it alone, so its skill of this repo is not linked there"
    return 0
  fi
  [ "$("$cu/readlink" "$1" 2>/dev/null || true)" = "$2" ] && return 0
  "$cu/ln" -sfn "$2" "$1" || warn "cannot link $1"
}

shared="$home/.agents/skills"
agents=("$home/.claude/skills" "$home/.codex/skills" "$home/.cursor/skills-cursor")
"$cu/mkdir" -p "$shared" "${agents[@]}" || {
  warn "cannot create the agents' skill folders; skipped linking skills"
  exit 0
}

# Every skill of every plugin: ~/.agents/skills/<skill> through the stable
# link, and each agent's folder to that.
for skill in "$target"/*/skills/*/; do
  [ -d "$skill" ] || continue
  rel="${skill#"$target"/}"
  rel="${rel%/}"
  name="${rel##*/}"
  link "$shared/$name" "$current/$rel"
  for dir in "${agents[@]}"; do
    link "$dir/$name" "$shared/$name"
  done
done

# Links this sync made for a skill the folder no longer has (they dangle), or
# the checkout-based script made (they point into $legacy): removed, with
# each agent's link to them.
for entry in "$shared"/*; do
  [ -L "$entry" ] || continue
  dest="$("$cu/readlink" "$entry")" || continue
  case "$dest" in
    "$current"/*) [ -e "$entry" ] && continue ;;
    "$legacy"/*) ;;
    *) continue ;;
  esac
  name="${entry##*/}"
  "$cu/rm" -f "$entry" || continue
  for dir in "${agents[@]}"; do
    if [ "$("$cu/readlink" "$dir/$name" 2>/dev/null || true)" = "$entry" ]; then
      "$cu/rm" -f "$dir/$name" || true
    fi
  done
  echo "Unlinked skill: $name"
done

# Oh My Pi loads a plugin through its own link to the folder; relinked every
# sync, since it is cheap and omp may have been installed since the last one.
omp=""
for candidate in "$(command -v omp 2>/dev/null || true)" "$home/.bun/bin/omp"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    omp="$candidate"
    break
  fi
done
if [ -n "$omp" ]; then
  for plugin in "$target"/*/package.json; do
    [ -f "$plugin" ] || continue
    plugin="${plugin%/package.json}"
    plugin="$current/${plugin##*/}"
    # omp is `#!/usr/bin/env bun`.
    PATH="$home/.bun/bin:$PATH" "$omp" plugin link "$plugin" >/dev/null 2>&1 \
      || warn "omp plugin link $plugin failed"
  done
fi
exit 0

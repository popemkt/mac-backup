# bb-plugins-sync: install this repo's bb plugins into the person's own bb
# server, from the store copies of the revision applied. ./default.nix
# prepends: home, plugins (an array of <plugin>=<store path>), and absolute
# paths to every tool (cu: coreutils' bin, find, flock, node, npm), since
# activation inherits no PATH worth trusting. Every step that can fail is
# guarded: this runs inside Home Manager activation, which must never abort
# over a plugin. A failed plugin warns, keeps what bb runs now, and the next
# sync retries it.

export PATH="$PATH:$home/.local/bin"

warn() { echo "warning: $*" >&2; }

try_path=""
case "${1:-}" in
  "") ;;
  --path)
    if [ -z "${2:-}" ] || [ ! -f "$2/package.json" ]; then
      echo "bb-plugins-sync: --path needs a bb plugin folder (with package.json)" >&2
      exit 2
    fi
    try_path="$(cd "$2" && pwd)"
    ;;
  *)
    echo "usage: bb-plugins-sync [--path <plugin-dir>]" >&2
    exit 2
    ;;
esac

bb=""
for candidate in \
  "$(command -v bb 2>/dev/null || true)" \
  "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" \
  "$home/.local/bin/bb"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    bb="$candidate"
    break
  fi
done
if [ -z "$bb" ]; then
  warn "bb is unavailable; skipped its tracked plugins"
  exit 0
fi

# Whose server: outside a thread the bb CLI targets 127.0.0.1:38886 whoever
# runs it, and on a host several people share that is one person's server
# (its API is unauthenticated). Install only into a server whose data
# directory is under this account's home, so one person's sync never
# re-registers another's plugins. This is also the readiness probe:
# dataDir is empty when no server answers.
data_dir=""
if status="$("$bb" status --json 2>/dev/null)"; then
  data_dir="$(printf '%s' "$status" | "$node" -e '
    let s = ""; process.stdin.on("data", d => (s += d)).on("end", () => {
      try { process.stdout.write(String(JSON.parse(s).dataDir ?? "")); } catch {}
    });' 2>/dev/null)" || data_dir=""
fi
case "$data_dir" in
  "")
    warn "no bb server answered; skipped its tracked plugins until the next rebuild"
    exit 0
    ;;
  "$home" | "$home"/*) ;;
  *)
    echo "bb-plugins-sync: the bb server here keeps its data in $data_dir, outside $home: it is another account's, so its plugins are left alone."
    exit 0
    ;;
esac

state="${XDG_STATE_HOME:-$home/.local/state}/dotfiles/bb-plugins"
if ! "$cu/mkdir" -p "$state"; then
  warn "cannot create $state; skipped bb plugins"
  exit 0
fi
# One sync at a time (activation and rebuild's own run can overlap), held
# from the listing on, so the second sees what the first installed.
if ! exec 9>>"$state/.lock"; then
  warn "cannot open $state/.lock; skipped bb plugins"
  exit 0
fi
if ! "$flock" -w 900 9; then
  warn "another bb-plugins-sync held $state/.lock for 15 minutes; skipped bb plugins"
  exit 0
fi

if ! listing="$("$bb" plugin list --json 2>/dev/null)"; then
  warn "no bb server answered; skipped its tracked plugins until the next rebuild"
  exit 0
fi

# npm ci, bounded: one retry, 30 s per fetch, so an offline rebuild fails
# fast. Its output goes to $state/npm.log (or the trial folder's), not to
# activation's.
npm_ci() {
  (cd "$1" && "$npm" ci --omit=optional --prefer-offline --no-audit --no-fund \
    --fetch-timeout=30000 --fetch-retries=1 \
    --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=5000 >>"$2" 2>&1)
}

if [ -n "$try_path" ]; then
  # A trial installs the folder in place, as a developer would.
  if [ ! -d "$try_path/node_modules" ]; then
    echo "Installing npm dependencies of bb plugin: $try_path"
    npm_ci "$try_path" /dev/stderr || { warn "npm ci failed for $try_path"; exit 1; }
  fi
  echo "Installing bb plugin: $try_path"
  "$bb" plugin install "$try_path" --yes >/dev/null || { warn "failed to install bb plugin $try_path"; exit 1; }
  echo "Installed $try_path; the next bb-plugins-sync (or rebuild) reinstalls the declared source."
  exit 0
fi

# Stamps of the checkout-based installer this replaced, and work an
# interrupted sync left half made.
"$cu/rm" -rf "$state"/assets_bb-plugins_* "$state"/.tmp.* "$state/npm.log" || true

# prune <dir>: keep the two newest entries (by use), delete the rest. Two,
# because bb may still serve the previous copy's dist/ until it reloads.
prune() {
  local old
  "$cu/ls" -1td "$1"/*/ 2>/dev/null | "$cu/tail" -n +3 | while IFS= read -r old; do
    "$cu/rm" -rf "$old"
  done
}

# deps <plugin> <store> <lockhash>: node_modules for that lockfile, installed
# once into $state/<plugin>/deps/<lockhash> and reused by every copy with the
# same lockfile, so a source-only change needs no network. Installed in a
# scratch folder and renamed into place only once npm ci succeeds.
deps() {
  local name="$1" store="$2" lock="$3" dest="$state/$1/deps/$3" tmp
  if [ -d "$dest" ]; then
    "$cu/touch" "$dest" || true
    return 0
  fi
  echo "Installing npm dependencies of bb plugin: $name"
  tmp="$("$cu/mktemp" -d "$state/.tmp.XXXXXX")" || return 1
  if "$cu/cp" -R "$store/$name/." "$tmp/" && "$cu/chmod" -R u+w "$tmp" && npm_ci "$tmp" "$state/npm.log" \
    && "$cu/mkdir" -p "$state/$name/deps" && "$cu/mv" "$tmp" "$dest"; then
    return 0
  fi
  "$cu/rm" -rf "$tmp" || true
  warn "npm ci failed for bb plugin $name (offline?); see $state/npm.log"
  return 1
}

# copy <plugin> <store> <deps> <dest>: the store copy, writable, with every
# node_modules folder of <deps> (a workspace has more than one), renamed into
# place whole, so a copy that exists is complete.
copy() {
  local name="$1" store="$2" deps="$3" dest="$4" tmp modules ok=true
  tmp="$("$cu/mktemp" -d "$state/.tmp.XXXXXX")" || return 1
  if "$cu/cp" -R "$store/." "$tmp/" && "$cu/chmod" -R u+w "$tmp" \
    && modules="$(cd "$deps" && "$find" . -name node_modules -type d -prune)"; then
    while IFS= read -r m; do
      [ -n "$m" ] || continue
      "$cu/cp" -R --reflink=auto "$deps/$m" "$tmp/$name/$m" || { ok=false; break; }
    done <<<"$modules"
  else
    ok=false
  fi
  if $ok && "$cu/mkdir" -p "$state/$name/src" && "$cu/mv" "$tmp" "$dest"; then
    return 0
  fi
  "$cu/rm" -rf "$tmp" || true
  warn "could not copy bb plugin $name into $state"
  return 1
}

for entry in "${plugins[@]}"; do
  name="${entry%%=*}"
  store="${entry#*=}"
  hash="${store##*/}"
  hash="${hash%%-*}"
  dest="$state/$name/src/$hash"
  dir="$dest/$name"
  # A here-string, not a pipe: under pipefail, grep -q exiting at the
  # first match SIGPIPEs printf on a long listing and reads as "absent".
  if [ -d "$dir" ] && "$grep" -qF "path:$dir\"" <<<"$listing"; then
    continue
  fi
  if [ ! -f "$store/$name/package-lock.json" ]; then
    warn "bb plugin $name has no package-lock.json; skipped it"
    continue
  fi
  if [ ! -d "$dest" ]; then
    lock="$("$cu/sha256sum" "$store/$name/package-lock.json")" || continue
    lock="${lock%% *}"
    deps "$name" "$store" "$lock" || continue
    copy "$name" "$store" "$state/$name/deps/$lock" "$dest" || continue
  fi
  echo "Installing bb plugin: $name ($hash)"
  if ! "$bb" plugin install "$dir" --yes >/dev/null; then
    warn "failed to install bb plugin $name; bb keeps what it ran"
    continue
  fi
  "$cu/touch" "$dest" || true
  prune "$state/$name/src" || true
  prune "$state/$name/deps" || true
done

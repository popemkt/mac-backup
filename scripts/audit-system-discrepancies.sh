#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW_CONFIG="$ROOT_DIR/hosts/darwin/default.nix"
NPM_CONFIG="$ROOT_DIR/modules/shared/npm-global.nix"
PACKAGES_CONFIG="$ROOT_DIR/modules/shared/packages.nix"
EXTERNAL_DATA_CONFIG="$ROOT_DIR/modules/shared/external-data.nix"

BREW_BIN="${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew"
NPM_BIN="${NPM_BIN:-npm}"

parse_nix_strings() {
  local file="$1"
  local anchor="$2"

  awk -v anchor="$anchor" '
    $0 ~ "^[[:space:]]*" anchor "[[:space:]]*=" { in_block=1; next }
    in_block && /\]/ { exit }
    in_block {
      line=$0
      sub(/#.*/, "", line)
      while (match(line, /"[^"]+"/)) {
        print substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$file" | sed '/^$/d'
}

parse_nix_packages() {
  awk '
    /home\.packages[[:space:]]*=/ { in_block=1; next }
    in_block && /\];/ { exit }
    in_block {
      line=$0
      sub(/#.*/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == "" || line == "[" || line == "]") next
      if (line ~ /^[[:alnum:]_.+-]+$/) print line
    }
  ' "$PACKAGES_CONFIG"
}

parse_external_paths() {
  awk '
    /^[[:space:]]*managedPaths[[:space:]]*=/ { in_block=1; next }
    in_block && /\]/ { exit }
    in_block {
      line=$0
      sub(/#.*/, "", line)
      while (match(line, /"[^"]+"/)) {
        print substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$EXTERNAL_DATA_CONFIG"
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

print_list() {
  if [ $# -eq 0 ]; then
    printf '  (none)\n'
    return
  fi

  local item
  for item in "$@"; do
    printf '  - %s\n' "$item"
  done
}

readarray_safe() {
  local __var_name="$1"
  shift
  local output
  output="$("$@" 2>/dev/null || true)"
  if [ -n "$output" ]; then
    mapfile -t "$__var_name" < <(printf '%s\n' "$output" | sed '/^$/d')
  else
    eval "$__var_name=()"
  fi
}

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

set_diff() {
  local -n left_ref=$1
  local -n right_ref=$2
  local result=()
  local item
  for item in "${left_ref[@]}"; do
    if ! array_contains "$item" "${right_ref[@]}"; then
      result+=("$item")
    fi
  done
  printf '%s\n' "${result[@]}"
}

sort_unique() {
  sort -u | sed '/^$/d'
}

normalize_brew_names() {
  awk -F/ '{ print $NF }' | sort -u | sed '/^$/d'
}

readarray_safe declared_brews parse_nix_strings "$BREW_CONFIG" "brews"
readarray_safe declared_casks parse_nix_strings "$BREW_CONFIG" "casks"
readarray_safe declared_npm parse_nix_strings "$NPM_CONFIG" "npmGlobalPackages"
readarray_safe declared_nix_packages parse_nix_packages
readarray_safe managed_external_paths parse_external_paths

print_section "Repo Declarations"
printf '  Nix packages tracked: %s\n' "${#declared_nix_packages[@]}"
printf '  Brew formulas tracked: %s\n' "${#declared_brews[@]}"
printf '  Brew casks tracked: %s\n' "${#declared_casks[@]}"
printf '  npm globals tracked: %s\n' "${#declared_npm[@]}"
printf '  external-data paths tracked: %s\n' "${#managed_external_paths[@]}"

if [ -x "$BREW_BIN" ]; then
  readarray_safe installed_brews_raw "$BREW_BIN" leaves
  readarray_safe installed_casks "$BREW_BIN" list --cask
  mapfile -t installed_brews < <(printf '%s\n' "${installed_brews_raw[@]}" | normalize_brew_names)
  mapfile -t declared_brews_normalized < <(printf '%s\n' "${declared_brews[@]}" | normalize_brew_names)

  mapfile -t unmanaged_brews < <(set_diff installed_brews declared_brews_normalized | sort_unique)
  mapfile -t missing_brews < <(set_diff declared_brews_normalized installed_brews | sort_unique)
  mapfile -t unmanaged_casks < <(set_diff installed_casks declared_casks | sort_unique)
  mapfile -t missing_casks < <(set_diff declared_casks installed_casks | sort_unique)
  mapfile -t brew_also_tracked_in_nix < <(
    for formula in "${installed_brews[@]}"; do
      if array_contains "$formula" "${declared_nix_packages[@]}"; then
        printf '%s\n' "$formula"
      fi
    done | sort_unique
  )

  print_section "Homebrew Drift"
  printf '  Brew binary: %s\n' "$BREW_BIN"
  printf '  Installed formula leaves: %s\n' "${#installed_brews[@]}"
  printf '  Installed casks: %s\n' "${#installed_casks[@]}"

  print_section "Homebrew Formulas Installed But Not Tracked"
  print_list "${unmanaged_brews[@]}"

  print_section "Homebrew Formulas Tracked But Missing"
  print_list "${missing_brews[@]}"

  print_section "Homebrew Casks Installed But Not Tracked"
  print_list "${unmanaged_casks[@]}"

  print_section "Homebrew Casks Tracked But Missing"
  print_list "${missing_casks[@]}"

  print_section "Homebrew Formulas Also Tracked In Nix"
  print_list "${brew_also_tracked_in_nix[@]}"
else
  print_section "Homebrew Drift"
  printf '  brew not found at %s\n' "$BREW_BIN"
fi

if command -v "$NPM_BIN" >/dev/null 2>&1; then
  readarray_safe installed_npm_raw "$NPM_BIN" ls -g --depth=0 --parseable
  mapfile -t installed_npm < <(
    printf '%s\n' "${installed_npm_raw[@]}" \
      | sed '1d' \
      | awk -F'/node_modules/' 'NF > 1 { print $2 }' \
      | sed '/^$/d' \
      | sort -u
  )

  mapfile -t unmanaged_npm < <(set_diff installed_npm declared_npm | sort_unique)
  mapfile -t missing_npm < <(set_diff declared_npm installed_npm | sort_unique)

  print_section "npm Global Drift"
  printf '  npm binary: %s\n' "$(command -v "$NPM_BIN")"

  print_section "npm Globals Installed But Not Tracked"
  print_list "${unmanaged_npm[@]}"

  print_section "npm Globals Tracked But Missing"
  print_list "${missing_npm[@]}"
else
  print_section "npm Global Drift"
  printf '  npm not found\n'
fi

print_section "Managed External Data"
printf '  Root: /Volumes/Data/workspace/symlinks/User\n'
for rel in "${managed_external_paths[@]}"; do
  src="$HOME/$rel"
  dst="/Volumes/Data/workspace/symlinks/User/$rel"
  if [ -L "$src" ]; then
    printf '  - linked: %s -> %s\n' "$src" "$(readlink "$src")"
  elif [ -e "$src" ]; then
    printf '  - real dir: %s\n' "$src"
  else
    printf '  - missing: %s\n' "$src"
  fi

  if [ -e "$dst" ]; then
    printf '    target exists: %s\n' "$dst"
  else
    printf '    target missing: %s\n' "$dst"
  fi
done

print_section "macOS /Applications Drift"

mapfile -t all_apps < <(
  {
    find /Applications -maxdepth 2 -name "*.app" -type d 2>/dev/null
    find "$HOME/Applications" -maxdepth 2 -name "*.app" -type d 2>/dev/null
  } | sort -u
)

cask_apps=()
cask_app_basenames=()
if [ -x "$BREW_BIN" ]; then
  mapfile -t cask_list < <("$BREW_BIN" list --cask 2>/dev/null)
  for c in "${cask_list[@]}"; do
    while IFS= read -r path; do
      if [ -n "$path" ]; then
        cask_apps+=("$path")
        cask_app_basenames+=("$(basename "$path")")
      fi
    done < <("$BREW_BIN" ls --cask "$c" 2>/dev/null | grep '\.app$' || true)
  done
fi

mas_apps=()
internet_apps=()
for app in "${all_apps[@]}"; do
  if array_contains "$(basename "$app")" "${cask_app_basenames[@]}"; then
    continue
  fi
  if [ -d "$app/Contents/_MASReceipt" ]; then
    mas_apps+=("$app")
  else
    internet_apps+=("$app")
  fi
done

printf '  Total .app bundles found: %s\n' "${#all_apps[@]}"
printf '  Brew cask managed: %s\n' "${#cask_apps[@]}"
printf '  Mac App Store: %s\n' "${#mas_apps[@]}"
printf '  Unmanaged (internet/manual): %s\n' "${#internet_apps[@]}"

print_section "Apps Installed Outside Brew (manual/internet)"
print_list "${internet_apps[@]}"

print_section "Mac App Store Apps"
print_list "${mas_apps[@]}"

print_section "Brew Cask Apps On Disk"
print_list "${cask_apps[@]}"

print_section "Tracked Nix Packages"
printf '%s\n' "${declared_nix_packages[@]}" | sed 's/^/  - /'

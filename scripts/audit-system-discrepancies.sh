#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Brew declarations live in the shared Homebrew module AND per-host files.
BREW_CONFIG_FILES=(
  "$ROOT_DIR/modules/darwin/system/homebrew.nix"
  "$ROOT_DIR"/hosts/*/default.nix
)
NPM_CONFIG="$ROOT_DIR/modules/common/home-manager/npm-global.nix"
BUN_CONFIG="$ROOT_DIR/modules/darwin/home-manager/bun-global.nix"
PACKAGES_CONFIG="$ROOT_DIR/modules/common/home-manager/packages.nix"
EXTERNAL_DATA_CONFIG="$ROOT_DIR/modules/darwin/system/external-workspace.nix"
UV_TOOLS_CONFIG_FILES=(
  "$ROOT_DIR/modules/stacks/ai-agents/headroom.nix"
  "$ROOT_DIR/modules/stacks/ai-agents/cognee.nix"
  "$ROOT_DIR/modules/stacks/ai-agents/cognee-client.nix"
)

BREW_BIN="${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew"
NPM_BIN="${NPM_BIN:-npm}"
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
UV_BIN="${UV_BIN:-uv}"

parse_nix_strings() {
  local file="$1"
  local anchor="$2"

  awk -v anchor="$anchor" '
    $0 ~ "^[[:space:]]*" anchor "[[:space:]]*=" { in_block=1; next }
    in_block && /^[[:space:]]*\]/ { exit }
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

# Parse an anchor's string list across every host file (base + per-host).
# Anchor matches both `casks = [` and `homebrew.casks = [` forms.
parse_nix_strings_all_hosts() {
  local anchor="$1"
  local f
  for f in "${BREW_CONFIG_FILES[@]}"; do
    parse_nix_strings "$f" "(homebrew\\.)?$anchor"
  done | sort -u
}

parse_nix_strings_many() {
  local anchor="$1"
  shift

  local f
  for f in "$@"; do
    [ -f "$f" ] || continue
    parse_nix_strings "$f" "$anchor"
  done | sort -u
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

# Strip uv pin/extras: "mempalace==3.3.1" / "headroom-ai[all]" -> bare name.
normalize_uv_names() {
  sed -E 's/(\[|==).*$//' | sort -u | sed '/^$/d'
}

# A uv tool is editable/local when its receipt records an editable source.
# Those are untracked by design (they live with their own repo), so we don't
# count them as drift.
uv_is_editable() {
  local name="$1"
  local receipt="$HOME/.local/share/uv/tools/$name/uv-receipt.toml"
  [ -f "$receipt" ] && grep -q 'editable' "$receipt"
}

readarray_safe declared_brews parse_nix_strings_all_hosts "brews"
readarray_safe declared_casks parse_nix_strings_all_hosts "casks"
readarray_safe declared_npm parse_nix_strings "$NPM_CONFIG" "npmGlobalPackages"
readarray_safe declared_bun parse_nix_strings "$BUN_CONFIG" "bunGlobalPackages"
readarray_safe declared_nix_packages parse_nix_packages
readarray_safe managed_external_paths parse_external_paths

print_section "Repo Declarations"
printf '  Nix packages tracked: %s\n' "${#declared_nix_packages[@]}"
printf '  Brew formulas tracked: %s\n' "${#declared_brews[@]}"
printf '  Brew casks tracked: %s\n' "${#declared_casks[@]}"
printf '  npm globals tracked: %s\n' "${#declared_npm[@]}"
printf '  Bun globals tracked: %s\n' "${#declared_bun[@]}"
printf '  external-data paths tracked: %s\n' "${#managed_external_paths[@]}"

forbidden_casks=()
if array_contains "orca" "${declared_casks[@]}"; then
  forbidden_casks+=("orca (use stablyai/orca/orca; bare orca is the Plotly cask)")
fi

print_section "Forbidden Homebrew Cask Declarations"
print_list "${forbidden_casks[@]}"

if [ -x "$BREW_BIN" ]; then
  readarray_safe installed_brews_raw "$BREW_BIN" leaves
  # Use full cask names so tapped casks do not collapse onto unrelated core
  # casks with the same token, e.g. stablyai/orca/orca vs homebrew/cask/orca.
  readarray_safe installed_casks "$BREW_BIN" list --cask --full-name
  mapfile -t installed_brews < <(printf '%s\n' "${installed_brews_raw[@]}" | normalize_brew_names)
  mapfile -t declared_brews_normalized < <(printf '%s\n' "${declared_brews[@]}" | normalize_brew_names)

  mapfile -t unmanaged_brews < <(set_diff installed_brews declared_brews_normalized | sort_unique)
  mapfile -t missing_brews < <(set_diff declared_brews_normalized installed_brews | sort_unique)
  mapfile -t declared_casks_sorted < <(printf '%s\n' "${declared_casks[@]}" | sort_unique)
  mapfile -t unmanaged_casks < <(set_diff installed_casks declared_casks_sorted | sort_unique)
  mapfile -t missing_casks < <(set_diff declared_casks_sorted installed_casks | sort_unique)
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

bun_global_manifest="$BUN_INSTALL/install/global/package.json"
if [ -f "$bun_global_manifest" ] && command -v jq >/dev/null 2>&1; then
  readarray_safe installed_bun jq -r '.dependencies // {} | keys[]' "$bun_global_manifest"
else
  installed_bun=()
fi

mapfile -t unmanaged_bun < <(set_diff installed_bun declared_bun | sort_unique)
mapfile -t missing_bun < <(set_diff declared_bun installed_bun | sort_unique)

print_section "Bun Global Drift"
printf '  Bun global manifest: %s\n' "$bun_global_manifest"

print_section "Bun Globals Installed But Not Tracked"
print_list "${unmanaged_bun[@]}"

print_section "Bun Globals Tracked But Missing"
print_list "${missing_bun[@]}"

if command -v "$UV_BIN" >/dev/null 2>&1; then
  readarray_safe declared_uv_raw parse_nix_strings_many "uvTools" "${UV_TOOLS_CONFIG_FILES[@]}"
  mapfile -t declared_uv < <(printf '%s\n' "${declared_uv_raw[@]}" | normalize_uv_names)

  readarray_safe uv_list_raw "$UV_BIN" tool list
  mapfile -t installed_uv < <(
    printf '%s\n' "${uv_list_raw[@]}" \
      | grep -E '^[A-Za-z0-9]' \
      | awk '{ print $1 }' \
      | sort -u
  )

  installed_uv_pypi=()
  installed_uv_editable=()
  for tool in "${installed_uv[@]}"; do
    if uv_is_editable "$tool"; then
      installed_uv_editable+=("$tool")
    else
      installed_uv_pypi+=("$tool")
    fi
  done

  mapfile -t unmanaged_uv < <(set_diff installed_uv_pypi declared_uv | sort_unique)
  mapfile -t missing_uv < <(set_diff declared_uv installed_uv | sort_unique)

  print_section "uv Tool Drift"
  printf '  uv binary: %s\n' "$(command -v "$UV_BIN")"
  printf '  Declared uv tools tracked: %s\n' "${#declared_uv[@]}"
  printf '  Installed uv tools: %s\n' "${#installed_uv[@]}"

  print_section "uv Tools Installed But Not Tracked"
  print_list "${unmanaged_uv[@]}"

  print_section "uv Tools Tracked But Missing"
  print_list "${missing_uv[@]}"

  print_section "uv Tools Local/Editable (untracked by design)"
  print_list "${installed_uv_editable[@]}"
else
  print_section "uv Tool Drift"
  printf '  uv not found\n'
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
    found_app=0
    while IFS= read -r path; do
      if [ -n "$path" ]; then
        cask_apps+=("$path")
        cask_app_basenames+=("$(basename "$path")")
        found_app=1
      fi
    done < <("$BREW_BIN" ls --cask "$c" 2>/dev/null | grep '\.app$' || true)

    # Some casks install purely via a .pkg installer (no `app` artifact stanza),
    # so `brew ls --cask` only shows the downloaded .pkg, never the resulting
    # .app bundles it drops in /Applications. Fall back to the cask's declared
    # `uninstall.pkgutil` receipt IDs and ask pkgutil what that receipt actually
    # installed, so pkg-based casks aren't misreported as unmanaged.
    if [ "$found_app" -eq 0 ] && command -v jq >/dev/null 2>&1 && command -v pkgutil >/dev/null 2>&1; then
      # .pkgutil is sometimes a bare string, sometimes an array - normalize both.
      mapfile -t pkg_ids < <("$BREW_BIN" info --cask "$c" --json=v2 2>/dev/null |
        jq -r '.casks[0].artifacts[]? | .uninstall[]?.pkgutil? | if type == "array" then .[] else . end' 2>/dev/null)
      for pkg_id in "${pkg_ids[@]}"; do
        [ -n "$pkg_id" ] || continue

        # Some receipts install-location IS the app bundle itself (e.g.
        # "Applications/Tailscale.app"), so the bundle never appears as an
        # entry inside `pkgutil --files` (which only lists what's *inside*
        # the install location). Catch that case directly first.
        pkg_location="$(pkgutil --pkg-info "$pkg_id" 2>/dev/null | awk -F': ' '/^location:/ {print $2}' || true)"
        case "$pkg_location" in
          */*.app | *.app)
            basename="$(basename "$pkg_location")"
            cask_apps+=("/Applications/$basename")
            cask_app_basenames+=("$basename")
            continue
            ;;
        esac

        while IFS= read -r rel_path; do
          [ -n "$rel_path" ] || continue
          # Depending on the pkg's install-location, receipts list either
          # "Applications/Foo.app" or just "Foo.app" - accept both, but only
          # top-level bundles (skip nested helper .apps inside Contents/...).
          basename=""
          case "$rel_path" in
            Applications/*.app)
              basename="${rel_path#Applications/}"
              ;;
            */*) ;; # nested path (e.g. Foo.app/Contents/...) - not top-level
            *.app)
              basename="$rel_path"
              ;;
          esac
          if [ -n "$basename" ]; then
            cask_apps+=("/Applications/$basename")
            cask_app_basenames+=("$basename")
          fi
        done < <(pkgutil --files "$pkg_id" 2>/dev/null | grep '\.app$' || true)
      done
    fi
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

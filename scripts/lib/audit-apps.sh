# shellcheck shell=bash
#
# The drift audit's /Applications report, sourced by
# scripts/audit-system-discrepancies.sh after scripts/lib/audit-probes.sh.
#
# report_app_drift <all-apps probe> <cask-list probe>
#
# Classify every .app bundle the /Applications scan found as Homebrew cask,
# Mac App Store or manually installed, and print the counts and lists. The
# cask-list probe index is empty when Homebrew is not installed. The caller
# defines BREW_BIN, array_contains, print_section and print_list.
report_app_drift() {
  local all_apps_probe="$1" cask_list_probe="$2"
  local all_apps=() cask_apps=() cask_app_basenames=() cask_list=()
  local mas_apps=() internet_apps=() pkg_ids=()
  local c found_app path pkg_id pkg_location basename rel_path app

  read_probe_into all_apps "$all_apps_probe" "/Applications scan" || true

  if [ -x "$BREW_BIN" ] \
    && read_probe_into cask_list "$cask_list_probe" "brew list --cask"; then
    for c in "${cask_list[@]}"; do
      found_app=0
      while IFS= read -r path; do
        if [ -n "$path" ]; then
          cask_apps+=("$path")
          cask_app_basenames+=("$(basename "$path")")
          found_app=1
        fi
      done < <("$BREW_BIN" ls --cask "$c" 2>/dev/null | grep '\.app$' || true)

      # Cask receipt aggregation stays serial after the cask-list probe settles.
      if [ "$found_app" -eq 0 ] && command -v jq >/dev/null 2>&1 && command -v pkgutil >/dev/null 2>&1; then
        mapfile -t pkg_ids < <("$BREW_BIN" info --cask "$c" --json=v2 2>/dev/null |
          jq -r '.casks[0].artifacts[]? | .uninstall[]?.pkgutil? | if type == "array" then .[] else . end' 2>/dev/null)
        for pkg_id in "${pkg_ids[@]}"; do
          [ -n "$pkg_id" ] || continue
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
            basename=""
            case "$rel_path" in
              Applications/*.app) basename="${rel_path#Applications/}" ;;
              */*) ;;
              *.app) basename="$rel_path" ;;
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
}

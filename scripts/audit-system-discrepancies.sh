#!/usr/bin/env bash
#
# shellcheck disable=SC2154,SC2034
# read_probe_into assigns through a nameref and set_diff takes
# array names rather than values, neither of which shellcheck can follow. No
# variable here is genuinely unassigned or unused.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTERNAL_DATA_CONFIG="$ROOT_DIR/modules/darwin/system/external-workspace.nix"
# Agent plugin channels are read from the evaluated host configuration, so the
# flake attribute for this machine has to resolve.
AUDIT_HOST="${AUDIT_HOST:-$(hostname -s)}"

BREW_BIN="${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew"
NPM_BIN="${NPM_BIN:-npm}"
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
UV_BIN="${UV_BIN:-uv}"

# Read a resolved list from the evaluated host configuration. Scanning Nix
# source cannot see stack contributions, host `extra.*` additions, or lists
# written on one line; evaluation is the only reading that matches what the
# executors actually install. Lines come back sorted and unique, as a set.
# Run it as a probe, so a failed evaluation is read through read_probe_into.
eval_host_list() {
  local apply="$1"
  nix eval --raw --no-warn-dirty \
    "$ROOT_DIR#darwinConfigurations.$AUDIT_HOST.config" \
    --apply "xs: builtins.concatStringsSep \"\\n\" (builtins.attrNames (builtins.listToAttrs (map (name: { inherit name; value = null; }) ($apply))))"
}

# Same, for a my.pkgs channel by name.
eval_channel() {
  eval_host_list "xs.my.pkgs.$1"
}

# Same, for a Home Manager option on the configured user.
eval_hm_list() {
  eval_host_list "xs.home-manager.users.\${xs.my.username}.$1"
}

# GAP [[01M3E9VYK1NK02TN5MYSQXS7C7]] scrapes Nix source instead of evaluating.
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

# Warnings/passes are tallied for a pytest-style summary on stderr at the end.
AUDIT_WARNINGS=()
AUDIT_PASS=0
AUDIT_FAIL=0
SECONDS=0
AUDIT_STARTED_AT="${EPOCHREALTIME:-}"

if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  _AUDIT_BOLD=$'\033[1m'
  _AUDIT_YELLOW=$'\033[33m'
  _AUDIT_RED=$'\033[31m'
  _AUDIT_GREEN=$'\033[32m'
  _AUDIT_DIM=$'\033[2m'
  _AUDIT_RESET=$'\033[0m'
else
  _AUDIT_BOLD=
  _AUDIT_YELLOW=
  _AUDIT_RED=
  _AUDIT_GREEN=
  _AUDIT_DIM=
  _AUDIT_RESET=
fi

# Silent pass — counts toward the summary without inventory noise.
record_pass() {
  AUDIT_PASS=$((AUDIT_PASS + 1))
}

# Record an actionable warning: bright line on stderr + summary entry.
record_warn() {
  local msg="$1"
  AUDIT_FAIL=$((AUDIT_FAIL + 1))
  AUDIT_WARNINGS+=("$msg")
  printf '%s%sWARNING:%s %s\n' \
    "$_AUDIT_BOLD" "$_AUDIT_YELLOW" "$_AUDIT_RESET" "$msg" >&2
}

# Visible positive status in the inventory stream + pass tally.
record_ok() {
  record_pass
  printf '  %sok%s %s\n' "$_AUDIT_GREEN" "$_AUDIT_RESET" "$1"
}

# Pass if count is 0, else warn with "$count $label".
check_count() {
  local count="$1"
  local label="$2"
  if [ "$count" -eq 0 ]; then
    record_pass
  else
    record_warn "$count $label"
  fi
}

# Detail under a warning (stderr, dim) — fix hints belong here.
warn_detail() {
  printf '  %s%s%s\n' "$_AUDIT_DIM" "$1" "$_AUDIT_RESET" >&2
}

_audit_elapsed() {
  local started="${AUDIT_STARTED_AT:-}"
  local now="${EPOCHREALTIME:-}"
  if [ -n "$started" ] && [ -n "$now" ]; then
    awk -v a="$started" -v b="$now" 'BEGIN { printf "%.1fs", b - a }'
    return
  fi
  printf '%ss' "${SECONDS:-0}"
}

print_warning_summary() {
  local count="${#AUDIT_WARNINGS[@]}"
  local i=1
  local msg
  local elapsed
  elapsed="$(_audit_elapsed)"
  local total=$((AUDIT_PASS + AUDIT_FAIL))

  printf '\n' >&2

  if [ "$count" -gt 0 ]; then
    printf '%s%s!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_RED" "$_AUDIT_RESET" >&2
    printf '%s%sAUDIT WARNINGS (%s) — action needed%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_YELLOW" "$count" "$_AUDIT_RESET" >&2
    printf '%s%s!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_RED" "$_AUDIT_RESET" >&2
    for msg in "${AUDIT_WARNINGS[@]}"; do
      printf '  %s%s%d.%s %s\n' \
        "$_AUDIT_BOLD" "$_AUDIT_YELLOW" "$i" "$_AUDIT_RESET" "$msg" >&2
      i=$((i + 1))
    done
    printf '%s%s!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_RED" "$_AUDIT_RESET" >&2
    printf '%sDetails above in the audit log; rebuild alone does not apply upgrades.%s\n' \
      "$_AUDIT_DIM" "$_AUDIT_RESET" >&2
  fi

  # Pytest / cargo-test style totals line — the thing you glance at.
  printf '\n' >&2
  printf '%s%s==================== audit summary ====================%s\n' \
    "$_AUDIT_BOLD" "$_AUDIT_DIM" "$_AUDIT_RESET" >&2
  if [ "$AUDIT_FAIL" -eq 0 ]; then
    printf '%s%s%s passed%s %sin %s%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_GREEN" "$AUDIT_PASS" "$_AUDIT_RESET" \
      "$_AUDIT_DIM" "$elapsed" "$_AUDIT_RESET" >&2
  else
    printf '%s%s%s failed%s, %s%s%s passed%s %sin %s (%s checks)%s\n' \
      "$_AUDIT_BOLD" "$_AUDIT_RED" "$AUDIT_FAIL" "$_AUDIT_RESET" \
      "$_AUDIT_BOLD" "$_AUDIT_GREEN" "$AUDIT_PASS" "$_AUDIT_RESET" \
      "$_AUDIT_DIM" "$elapsed" "$total" "$_AUDIT_RESET" >&2
  fi
  printf '%s%s=======================================================%s\n' \
    "$_AUDIT_BOLD" "$_AUDIT_DIM" "$_AUDIT_RESET" >&2
}

# Probe workers only capture command results. The parent waits and consumes them
# in a fixed order, so report rendering and audit state remain single-writer.
# shellcheck source=SCRIPTDIR/lib/audit-probes.sh
. "$ROOT_DIR/scripts/lib/audit-probes.sh"
# shellcheck source=SCRIPTDIR/lib/audit-apps.sh
. "$ROOT_DIR/scripts/lib/audit-apps.sh"

# Report a pin tool's `check` run, read by the pin-tool contract stated in the
# scripts/uv-sources header.
report_pin_check() {
  local label="$1" pending="$2" rc="$3" out="$4" current
  current="$(printf '%s\n' "$out" | grep -m1 'pins are current' || true)"
  if [ "$rc" = 10 ]; then
    record_warn "$pending"
    printf '%s\n' "$out" | sed 's/^/    /'
    warn_detail "fix: update-system → review → apply-system-update"
  elif [ "$rc" = 0 ] && [ -n "$current" ]; then
    record_ok "$current"
  else
    printf '  %s: not confirmed current (exit %s)\n' "$label" "$rc"
    printf '%s\n' "$out" | sed '/^$/d; s/^/    /'
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

# Strip uv pin/extras: "pkg==1.2.3" / "cognee[ollama]" -> bare name.
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

# homebrew.{brews,casks,taps} normalize to submodules, so project to the name.
brew_names() {
  eval_host_list "map (x: if builtins.isAttrs x then x.name else x) xs.homebrew.$1"
}

# Declarations are independent evaluations. Capture no more than eight at once;
# load their results below in the original declaration order.
declared_brews_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start brew_names brews
declared_casks_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start brew_names casks
declared_taps_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start brew_names taps
declared_npm_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start eval_hm_list 'my.resolvedNpmGlobals'
audit_probe_wait_all

declared_bun_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start eval_hm_list 'my.resolvedBunGlobals'
declared_nix_packages_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start eval_host_list 'map (p: p.pname or (builtins.parseDrvName p.name).name)
    (builtins.filter builtins.isAttrs
      xs.home-manager.users.${xs.my.username}.home.packages)'
managed_external_paths_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start parse_external_paths
audit_probe_wait_all

if ! {
  read_probe_into declared_brews "$declared_brews_probe" "Homebrew formula declarations" \
    && read_probe_into declared_casks "$declared_casks_probe" "Homebrew cask declarations" \
    && read_probe_into declared_taps "$declared_taps_probe" "Homebrew tap declarations" \
    && read_probe_into declared_npm "$declared_npm_probe" "npm global declarations" \
    && read_probe_into declared_bun "$declared_bun_probe" "Bun global declarations" \
    && read_probe_into declared_nix_packages "$declared_nix_packages_probe" "Nix package declarations"
}; then
  printf 'error: could not evaluate host %s; declarations below would be wrong\n' \
    "$AUDIT_HOST" >&2
  exit 1
fi

print_section "Repo Declarations"
printf '  Nix packages tracked: %s\n' "${#declared_nix_packages[@]}"
printf '  Brew formulas tracked: %s\n' "${#declared_brews[@]}"
printf '  Brew casks tracked: %s\n' "${#declared_casks[@]}"
printf '  Brew taps tracked: %s\n' "${#declared_taps[@]}"
printf '  npm globals tracked: %s\n' "${#declared_npm[@]}"
printf '  Bun globals tracked: %s\n' "${#declared_bun[@]}"

forbidden_casks=()
if array_contains "orca" "${declared_casks[@]}"; then
  forbidden_casks+=("orca (use stablyai/orca/orca; bare orca is the Plotly cask)")
fi

print_section "Forbidden Homebrew Cask Declarations"
print_list "${forbidden_casks[@]}"
check_count "${#forbidden_casks[@]}" "forbidden Homebrew cask declaration(s)"

# Installed package inventories are independent command probes. Their results
# are collected before the existing, dependency-sensitive diff calculations.
brew_leaves_probe=
brew_casks_probe=
npm_probe=
bun_probe=
if [ -x "$BREW_BIN" ]; then
  brew_leaves_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$BREW_BIN" leaves
  brew_casks_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$BREW_BIN" list --cask --full-name
fi
if command -v "$NPM_BIN" >/dev/null 2>&1; then
  npm_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$NPM_BIN" ls -g --depth=0 --parseable
fi
bun_global_manifest="$BUN_INSTALL/install/global/package.json"
if [ -f "$bun_global_manifest" ] && command -v jq >/dev/null 2>&1; then
  bun_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start jq -r '.dependencies // {} | keys[]' "$bun_global_manifest"
fi
audit_probe_wait_all

if [ ! -x "$BREW_BIN" ]; then
  print_section "Homebrew Drift"
  printf '  brew not found at %s\n' "$BREW_BIN"
  record_warn "Homebrew binary not found at $BREW_BIN"
# Use full cask names so tapped casks do not collapse onto unrelated core
# casks with the same token, e.g. stablyai/orca/orca vs homebrew/cask/orca.
elif read_probe_into installed_brews_raw "$brew_leaves_probe" "brew leaves" \
  && read_probe_into installed_casks "$brew_casks_probe" "brew list --cask"; then
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
  check_count "${#unmanaged_brews[@]}" "Homebrew formula(s) installed but not tracked"

  print_section "Homebrew Formulas Tracked But Missing"
  print_list "${missing_brews[@]}"
  check_count "${#missing_brews[@]}" "Homebrew formula(s) tracked but missing"

  print_section "Homebrew Casks Installed But Not Tracked"
  print_list "${unmanaged_casks[@]}"
  check_count "${#unmanaged_casks[@]}" "Homebrew cask(s) installed but not tracked"

  print_section "Homebrew Casks Tracked But Missing"
  print_list "${missing_casks[@]}"
  check_count "${#missing_casks[@]}" "Homebrew cask(s) tracked but missing"

  print_section "Homebrew Formulas Also Tracked In Nix"
  print_list "${brew_also_tracked_in_nix[@]}"
fi

if ! command -v "$NPM_BIN" >/dev/null 2>&1; then
  print_section "npm Global Drift"
  printf '  npm not found\n'
elif read_probe_into installed_npm_raw "$npm_probe" "npm ls -g"; then
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
  check_count "${#unmanaged_npm[@]}" "npm global(s) installed but not tracked"

  print_section "npm Globals Tracked But Missing"
  print_list "${missing_npm[@]}"
  check_count "${#missing_npm[@]}" "npm global(s) tracked but missing"
fi

# No global manifest means Bun has installed nothing, which is a real empty
# inventory; a manifest that could not be read is not.
installed_bun=()
if [ -z "$bun_probe" ] || read_probe_into installed_bun "$bun_probe" "Bun global manifest read"; then
  mapfile -t unmanaged_bun < <(set_diff installed_bun declared_bun | sort_unique)
  mapfile -t missing_bun < <(set_diff declared_bun installed_bun | sort_unique)

  print_section "Bun Global Drift"
  printf '  Bun global manifest: %s\n' "$bun_global_manifest"

  print_section "Bun Globals Installed But Not Tracked"
  print_list "${unmanaged_bun[@]}"
  check_count "${#unmanaged_bun[@]}" "Bun global(s) installed but not tracked"

  print_section "Bun Globals Tracked But Missing"
  print_list "${missing_bun[@]}"
  check_count "${#missing_bun[@]}" "Bun global(s) tracked but missing"
fi

if ! command -v "$UV_BIN" >/dev/null 2>&1; then
  print_section "uv Tool Drift"
  printf '  uv not found\n'
else
  uv_declarations_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start eval_channel uvTools
  uv_list_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$UV_BIN" tool list
  audit_probe_wait_all
fi

if command -v "$UV_BIN" >/dev/null 2>&1 \
  && read_probe_into declared_uv_raw "$uv_declarations_probe" "uvTools evaluation" \
  && read_probe_into uv_list_raw "$uv_list_probe" "uv tool list"; then
  mapfile -t declared_uv < <(printf '%s\n' "${declared_uv_raw[@]}" | normalize_uv_names)

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
  check_count "${#unmanaged_uv[@]}" "uv tool(s) installed but not tracked"

  print_section "uv Tools Tracked But Missing"
  print_list "${missing_uv[@]}"
  check_count "${#missing_uv[@]}" "uv tool(s) tracked but missing"

  print_section "uv Tools Local/Editable (untracked by design)"
  print_list "${installed_uv_editable[@]}"
fi

# Agent plugins report presence only. Their CLIs render versions
# inconsistently (semver, git sha, or "unknown"), so version equality is not a
# usable drift signal.
audit_agent_plugins() {
  local label="$1" attr="$2"
  shift 2

  local declared=() installed=() raw=()

  if ! command -v "$1" >/dev/null 2>&1; then
    print_section "$label Plugin Drift"
    printf '  %s not found\n' "$1"
    return
  fi

  local declared_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start eval_channel "$attr"
  local list_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$@"
  audit_probe_wait_all
  read_probe_into declared "$declared_probe" "$label plugin declarations" || return 0
  read_probe_into raw "$list_probe" "$label plugin list" || return 0
  mapfile -t installed < <(
    printf '%s\n' "${raw[@]}" \
      | grep -oE '[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+' \
      | sort -u
  )

  local unmanaged=() missing=()
  mapfile -t unmanaged < <(set_diff installed declared | sort_unique)
  mapfile -t missing < <(set_diff declared installed | sort_unique)

  print_section "$label Plugin Drift"
  printf '  Declared %s plugins tracked: %s\n' "$label" "${#declared[@]}"
  printf '  Installed %s plugins: %s\n' "$label" "${#installed[@]}"

  print_section "$label Plugins Installed But Not Tracked"
  print_list "${unmanaged[@]}"
  check_count "${#unmanaged[@]}" "$label plugin(s) installed but not tracked"

  print_section "$label Plugins Tracked But Missing"
  print_list "${missing[@]}"
  check_count "${#missing[@]}" "$label plugin(s) tracked but missing"
}

# Plugin declaration and list probes remain serial within this helper because
# its report aggregation depends on both inputs.
audit_agent_plugins "Claude Code" claudePlugins claude plugin list
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}" \
  audit_agent_plugins "Codex" codexPlugins codex plugin list

managed_external_paths=()
if read_probe_into managed_external_paths "$managed_external_paths_probe" "external-data path scan"; then
  print_section "Managed External Data"
  printf '  Root: /Volumes/Data/workspace/symlinks/User\n'
  printf '  Paths tracked: %s\n' "${#managed_external_paths[@]}"
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
fi

print_section "kb Media Backup (Mackup)"
if [ -x "$ROOT_DIR/scripts/check-kb-assets-backup.sh" ]; then
  # Static ownership regression: the Mackup declaration, .gitignore, backup
  # docs, and committed node asset references must all stay consistent.
  if "$ROOT_DIR/scripts/check-kb-assets-backup.sh" check >/dev/null 2>&1; then
    record_ok "kb media ownership declaration intact"
  else
    record_warn "kb media backup ownership declaration is broken"
    warn_detail "fix: run $ROOT_DIR/scripts/check-kb-assets-backup.sh check; review modules/darwin/home-manager/mackup.nix, .gitignore, docs/backup-strategy.md, .kb/nodes.jsonl"
  fi

  # Runtime coverage: local media dir vs iCloud Mackup storage. The status
  # command prints tagged PASS:/WARN:/INFO: lines that tally into the audit.
  while IFS= read -r line; do
    case "$line" in
      PASS:*) record_ok "${line#PASS: }" ;;
      WARN:*) record_warn "${line#WARN: }" ;;
      INFO:*) printf '  %s\n' "${line#INFO: }" ;;
    esac
  done < <("$ROOT_DIR/scripts/check-kb-assets-backup.sh" status)
else
  record_warn "scripts/check-kb-assets-backup.sh missing"
fi

all_apps_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start audit_probe_app_paths /Applications "$HOME/Applications"
cask_list_probe=
if [ -x "$BREW_BIN" ]; then
  cask_list_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$BREW_BIN" list --cask
fi
audit_probe_wait_all
report_app_drift "$all_apps_probe" "$cask_list_probe"
print_section "Tracked Nix Packages"
printf '%s\n' "${declared_nix_packages[@]}" | sed 's/^/  - /'

# Out-of-band surfaces are advisory: warn and stay exit 0.
print_section "Out-of-band Freshness (advisory)"

# Collect up to eight independent commands, then let the parent map results in
# the existing report order.
determinate_status_probe=
nix_version_probe=
softwareupdate_probe=
brew_outdated_probe=
if command -v determinate-nixd >/dev/null 2>&1; then
  determinate_status_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start audit_probe_combined determinate-nixd status
  nix_version_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start nix --version
fi
if command -v softwareupdate >/dev/null 2>&1; then
  softwareupdate_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start audit_probe_combined softwareupdate -l
fi
if [ -x "$BREW_BIN" ]; then
  brew_outdated_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start "$BREW_BIN" outdated
fi
audit_probe_wait_all

uv_check_probe=
gh_check_probe=
if [ -x "$ROOT_DIR/scripts/uv-sources" ]; then
  uv_check_probe=${#AUDIT_PROBE_PIDS[@]}
  audit_probe_start audit_probe_combined "$ROOT_DIR/scripts/uv-sources" check --best-effort
fi
if [ -x "$ROOT_DIR/scripts/github-sources" ]; then
  gh_check_probe=${#AUDIT_PROBE_PIDS[@]}
  # Through the flake app: check resolves releases with nvfetcher, which only
  # the app's runtime inputs guarantee.
  audit_probe_start audit_probe_combined \
    env GITHUB_SOURCES_ROOT="$ROOT_DIR" \
    nix run "$ROOT_DIR#github-sources" -- check --best-effort
fi

# The upgrade notice is on stderr, so the status probe reads combined output;
# a pass needs the status command itself to have succeeded. The report derives
# from the status read; the nix --version read only labels it, so its failure
# costs the label and never the report.
determinate_lines=()
nix_version_lines=()
if ! command -v determinate-nixd >/dev/null 2>&1; then
  record_warn "determinate-nixd not found"
elif read_probe_into determinate_lines "$determinate_status_probe" "determinate-nixd status"; then
  determinate_status="$(printf '%s\n' "${determinate_lines[@]}")"
  nix_version_line=
  if read_probe_into nix_version_lines "$nix_version_probe" "nix --version"; then
    nix_version_line="${nix_version_lines[0]:-}"
  fi
  if printf '%s\n' "$determinate_status" | grep -qiE 'out of date|now available'; then
    available="$(printf '%s\n' "$determinate_status" | grep -oE 'Determinate Nix [0-9]+(\.[0-9]+)+' | head -1 | awk '{ print $3 }')"
    current="$(printf '%s\n' "$nix_version_line" | grep -oE 'Determinate Nix [0-9]+(\.[0-9]+)+' | head -1 | awk '{ print $3 }')"
    if [ -n "$available" ] && [ -n "$current" ]; then
      record_warn "Determinate Nix $current → $available available"
    else
      record_warn "Determinate Nix is out of date"
    fi
    warn_detail "fix: upgrade-out-of-band"
  elif [ "$(audit_probe_status "$determinate_status_probe")" = 0 ]; then
    record_ok "Determinate Nix current (${nix_version_line:-unknown})"
  else
    printf '  Determinate Nix: could not determine (%s)\n' "${determinate_lines[-1]}"
  fi
fi

softwareupdate_lines=()
if ! command -v softwareupdate >/dev/null 2>&1; then
  record_warn "softwareupdate not found"
elif read_probe_into softwareupdate_lines "$softwareupdate_probe" "softwareupdate -l"; then
  softwareupdate_out="$(printf '%s\n' "${softwareupdate_lines[@]}")"
  mapfile -t os_updates < <(printf '%s\n' "$softwareupdate_out" | sed -nE 's/^[[:space:]]*\*[[:space:]]*Label:[[:space:]]*(.*)$/\1/p')
  if [ "${#os_updates[@]}" -gt 0 ]; then
    record_warn "macOS software update(s) available: ${os_updates[*]}"
    for label in "${os_updates[@]}"; do printf '    - %s\n' "$label"; done
    warn_detail "fix: upgrade-out-of-band (lists; install via System Settings)"
  elif printf '%s\n' "$softwareupdate_out" | grep -qiE 'No new software available|No updates'; then
    record_ok "macOS softwareupdate: none pending"
  else
    printf '  macOS softwareupdate: could not determine (offline or deferred)\n'
  fi
fi

brew_outdated=()
if [ -x "$BREW_BIN" ] \
  && read_probe_into brew_outdated "$brew_outdated_probe" "brew outdated"; then
  if [ "${#brew_outdated[@]}" -gt 0 ]; then
    record_warn "${#brew_outdated[@]} Homebrew package(s) outdated"
    sample_count=10
    i=0
    for pkg in "${brew_outdated[@]}"; do
      [ "$i" -lt "$sample_count" ] || break
      printf '    - %s\n' "$pkg"
      i=$((i + 1))
    done
    if [ "${#brew_outdated[@]}" -gt "$sample_count" ]; then
      printf '    … %s more\n' "$((${#brew_outdated[@]} - sample_count))"
    fi
    warn_detail "fix: apply-system-update (or update-homebrew)"
  else
    record_ok "Homebrew outdated: none"
  fi
fi

audit_probe_wait_all
if [ -x "$ROOT_DIR/scripts/uv-sources" ]; then
  uv_check_lines=()
  if read_probe_into uv_check_lines "$uv_check_probe" "uv-sources check"; then
    report_pin_check "uv pins" "uv tool pins have newer PyPI releases" \
      "$(audit_probe_status "$uv_check_probe")" "$(printf '%s\n' "${uv_check_lines[@]}")"
  fi
fi
gh_check_lines=()
if [ -x "$ROOT_DIR/scripts/github-sources" ] \
  && read_probe_into gh_check_lines "$gh_check_probe" "github-sources check"; then
  gh_check_clean="$(printf '%s\n' "${gh_check_lines[@]}" | grep -vE "^warning: Git tree|^warning: ignoring|^this derivation|^building '|^  /nix/store/" || true)"
  report_pin_check "GitHub release pins" "GitHub release pins have newer upstreams" \
    "$(audit_probe_status "$gh_check_probe")" "$gh_check_clean"
fi

print_warning_summary
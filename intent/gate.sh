#!/usr/bin/env bash
# intent/gate.sh — single admission gate for this repo.
#
# The repo is the durable record of an intent => behavior translation process.
# Every interaction surface (human shell, agent harness, git) routes here via a
# thin shim; the registry of surfaces lives in intent/SURFACES.md.
#
# Modes:
#   session [surface]   env handshake: required tools present? exit 1 = hard fail
#   record  [surface]   record admission: validates the staged git index
#                       (invoked by .githooks/pre-commit)
#   audit               verify every shim registered in SURFACES.md exists and
#                       routes to this gate
#
# Tool tiers mirror flake.nix devShell — update together.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-session}"
SURFACE="${2:-unspecified}"

HARD_TOOLS=(git jq nix nixfmt statix deadnix kb)
SOFT_TOOLS=(shellcheck actionlint nvfetcher)
ADMISSION_CHECKS_DIR=""

check_env() {
  local hard_missing=() soft_missing=() t
  for t in "${HARD_TOOLS[@]}"; do
    command -v "$t" >/dev/null 2>&1 || hard_missing+=("$t")
  done
  for t in "${SOFT_TOOLS[@]}"; do
    command -v "$t" >/dev/null 2>&1 || soft_missing+=("$t")
  done
  # kb is called by name from PATH (this gate, CI, .mcp.json), so the kb found
  # there must be the release the repo pins, not an older install or a shim.
  local kb_pinned kb_found
  if command -v kb >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    kb_pinned="$(jq -r '.kb.version // empty' "$REPO_ROOT/_sources/generated.json" 2>/dev/null || true)"
    kb_found="$(kb --version 2>/dev/null || true)"
    if [ -n "$kb_pinned" ] && [ "$kb_found" != "$kb_pinned" ]; then
      echo "STALE_TOOL: kb on PATH ($(command -v kb)) is '${kb_found}', the pin is '${kb_pinned}'"
      hard_missing+=("kb@$kb_pinned")
    fi
  fi

  # Every custom merge driver .gitattributes names must resolve to a program:
  # git that cannot run one marks the file conflicted but keeps only one side.
  local driver_name driver_cmd
  while IFS= read -r driver_name; do
    driver_cmd="$(git -C "$REPO_ROOT" config --get "merge.$driver_name.driver" || true)"
    if [ -z "$driver_cmd" ] || ! (cd "$REPO_ROOT" && command -v "${driver_cmd%% *}" >/dev/null 2>&1); then
      echo "UNRESOLVED_DRIVER: merge.$driver_name.driver = '${driver_cmd}' $(git -C "$REPO_ROOT" config --show-origin --get "merge.$driver_name.driver" 2>/dev/null | cut -f1)"
      hard_missing+=("merge.$driver_name.driver")
    fi
  done < <(
    grep -oE 'merge=[A-Za-z0-9_.-]+' "$REPO_ROOT/.gitattributes" 2>/dev/null \
      | cut -d= -f2 | grep -vxE 'text|binary|union' | sort -u
  )
  [ ${#soft_missing[@]} -gt 0 ] && echo "SOFT_MISSING: ${soft_missing[*]}"
  if [ ${#hard_missing[@]} -gt 0 ]; then
    echo "HARD_MISSING: ${hard_missing[*]}"
    return 1
  fi
  return 0
}

record_admission() {
  cd "$REPO_ROOT"

  # Validate the exact Git index snapshot, never unstaged working-tree content.
  staged_files=$(git diff --cached --name-only --diff-filter=ACMR)
  # Every staged path, deletions included: what decides which checks run.
  staged_paths=$(git diff --cached --name-only --diff-filter=ACMRD)
  source_files_staged=$(
    printf '%s\n' "$staged_paths" \
      | grep -E '^(nvfetcher\.toml|_sources/|pkgs/)' \
      | grep -vE '^pkgs/system-setup/' \
      || true
  )

  staged_tree=$(mktemp -d)
  trap 'rm -rf "$staged_tree"' EXIT
  git checkout-index --all --prefix="$staged_tree/"

  # The kb data checks, each run only when one of its inputs is staged: the
  # snapshot hides unstaged edits, so a check whose inputs are all unchanged
  # can only repeat its last answer.
  #   docs    kb data and the generated docs it is compared against
  #   assets  committed node text, plus the files that declare who owns
  #           .kb/assets and the script that reads them
  if grep -qE '^(\.kb/|docs/kb/)' <<<"$staged_paths"; then
    echo "==> kb generated docs (staged snapshot)"
    (cd "$staged_tree" && kb docs check)
  fi
  if grep -qE '^(\.kb/|\.gitignore$|docs/backup-strategy\.md$|modules/darwin/home-manager/mackup\.nix$|scripts/check-kb-assets-backup\.sh$)' <<<"$staged_paths"; then
    echo "==> kb media backup ownership (staged snapshot)"
    KB_ASSETS_ROOT="$staged_tree" "$staged_tree/scripts/check-kb-assets-backup.sh" check
  fi

  # The whole-store kb checks run on every commit. Their inputs are every file
  # the store names (each rule's home, each check's evidence) and every GAP
  # marker in the tree, a set only kb can list, so no path filter fits them.
  #   audit   rules and checks are wired to what they name, honestly
  #   gaps    every GAP marker names an open #gap node
  echo "==> kb check audit (staged snapshot)"
  (cd "$staged_tree" && kb check audit)
  # kb check gaps scans the files it is given. checkout-index wrote every
  # index entry, so the index's own list is exactly the snapshot's files.
  echo "==> kb check gaps (staged snapshot)"
  git ls-files -z | (cd "$staged_tree" && kb check gaps --files-from -)

  # Admission asks whether the staged sources are consistent, never whether
  # upstream has published something newer (docs/github-release-packages.md).
  if [ -n "$source_files_staged" ]; then
    echo "==> Generated GitHub sources (staged snapshot)"
    # verify --best-effort already passes when the pinned artifacts' hosts are
    # unreachable; any other failure is real.
    set +e
    GITHUB_SOURCES_ROOT="$staged_tree" \
      GITHUB_SOURCES_COMMAND_ROOT="$(pwd)" \
      nix run "path:$staged_tree#github-sources" -- verify --best-effort
    source_verify_status=$?
    set -e

    if [ "$source_verify_status" -ne 0 ]; then
      echo "error: staged GitHub sources are inconsistent or invalid" >&2
      exit "$source_verify_status"
    fi
  fi

  staged_nix=$(printf '%s\n' "$staged_files" | grep '\.nix$' || true)
  nix_changes_staged=$(
    printf '%s\n' "$staged_paths" \
      | grep '\.nix$' \
      || true
  )
  [ -z "$nix_changes_staged" ] && return 0

  # These checks all read the immutable staged snapshot and do not share
  # outputs. Run them concurrently, then replay output in a stable order.
  # This preserves every admission gate while cutting the slow Nix path.
  local check_failed=0 check_index
  local -a check_pids=() check_outputs=()
  ADMISSION_CHECKS_DIR="$(mktemp -d)"
  trap 'rm -rf "$staged_tree" "$ADMISSION_CHECKS_DIR"' EXIT

  run_admission_check() {
    local label="$1"
    shift
    check_index="${#check_pids[@]}"
    check_outputs+=("$ADMISSION_CHECKS_DIR/$check_index.out")
    echo "==> $label"
    ("$@") >"${check_outputs[$check_index]}" 2>&1 &
    check_pids+=("$!")
  }

  check_nixfmt() {
    local file
    while IFS= read -r file; do
      nixfmt --check "$staged_tree/$file"
    done <<<"$staged_nix"
  }

  if [ -n "$staged_nix" ]; then
    run_admission_check "nixfmt --check" check_nixfmt
  fi
  run_admission_check "statix check (whole repo)" bash -c 'cd "$1" && statix check .' bash "$staged_tree"
  run_admission_check "deadnix --fail (excluding generated Nix)" "$staged_tree/scripts/deadnix-repo" "$staged_tree"
  run_admission_check "nix flake check --no-build" nix flake check "path:$staged_tree" --no-build

  for check_index in "${!check_pids[@]}"; do
    if ! wait "${check_pids[$check_index]}"; then
      check_failed=1
    fi
    if [ -s "${check_outputs[$check_index]}" ]; then
      cat "${check_outputs[$check_index]}"
    fi
  done

  if [ "$check_failed" -ne 0 ]; then
    echo "error: staged Nix admission check failed" >&2
    exit 1
  fi
}

audit_surfaces() {
  local reg="$REPO_ROOT/intent/SURFACES.md" fail=0 shim
  if [ ! -f "$reg" ]; then
    echo "gate: registry missing: intent/SURFACES.md" >&2
    exit 1
  fi
  # Shim paths = backticked repo-relative paths in the Shim column (4th table field).
  # shellcheck disable=SC2016 # backticks in the grep below are literal markdown
  while IFS= read -r shim; do
    if [ ! -e "$REPO_ROOT/$shim" ]; then
      echo "AUDIT FAIL: registered shim missing: $shim"
      fail=1
      continue
    fi
    if ! grep -q "gate\.sh" "$REPO_ROOT/$shim"; then
      echo "AUDIT FAIL: shim does not route to gate: $shim"
      fail=1
      continue
    fi
    echo "ok: $shim"
  done < <(grep '^|' "$reg" | awk -F'|' '{print $4}' | grep -oE '`[^`]+`' | tr -d '`' | sort -u)
  exit "$fail"
}

case "$MODE" in
  session)
    check_env
    ;;
  record)
    if ! check_env; then
      echo "gate: record admission refused — restore env first (rebuild or nix develop) [surface: $SURFACE]" >&2
      exit 1
    fi
    record_admission
    ;;
  audit)
    audit_surfaces
    ;;
  *)
    echo "usage: intent/gate.sh {session|record|audit} [surface]" >&2
    exit 64
    ;;
esac

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

HARD_TOOLS=(git jq nix nixfmt statix deadnix)
SOFT_TOOLS=(shellcheck actionlint nvfetcher)

check_env() {
  local hard_missing=() soft_missing=() t
  for t in "${HARD_TOOLS[@]}"; do
    command -v "$t" >/dev/null 2>&1 || hard_missing+=("$t")
  done
  for t in "${SOFT_TOOLS[@]}"; do
    command -v "$t" >/dev/null 2>&1 || soft_missing+=("$t")
  done
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
  source_files_staged=$(
    git diff --cached --name-only --diff-filter=ACMRD \
      | grep -E '^(nvfetcher\.toml|_sources/|pkgs/)' \
      || true
  )

  staged_tree=$(mktemp -d)
  trap 'rm -rf "$staged_tree"' EXIT
  git checkout-index --all --prefix="$staged_tree/"

  if [ -x "$staged_tree/scripts/github-sources" ]; then
    echo "==> GitHub release pins (best effort)"
    set +e
    source_check_output=$(
      GITHUB_SOURCES_ROOT="$staged_tree" \
        GITHUB_SOURCES_COMMAND_ROOT="$(pwd)" \
        "$staged_tree/scripts/github-sources" check --best-effort 2>&1
    )
    source_check_status=$?
    set -e

    if [ -n "$source_check_output" ]; then
      printf '%s\n' "$source_check_output"
    fi

    if [ "$source_check_status" -eq 10 ]; then
      if [ -n "$source_files_staged" ]; then
        echo "error: update GitHub sources before committing package/source changes" >&2
        exit 1
      fi
      echo "warning: updates are available, but this commit does not change GitHub source files" >&2
    elif [ "$source_check_status" -ne 0 ]; then
      if [ -n "$source_files_staged" ]; then
        echo "error: GitHub source metadata could not be validated" >&2
        exit "$source_check_status"
      fi
      echo "warning: GitHub release check could not run; continuing" >&2
    fi
  fi

  if [ -n "$source_files_staged" ]; then
    echo "==> Generated GitHub sources (staged snapshot)"
    set +e
    GITHUB_SOURCES_ROOT="$staged_tree" \
      GITHUB_SOURCES_COMMAND_ROOT="$(pwd)" \
      nix run "path:$staged_tree#github-sources" -- verify --best-effort
    source_verify_status=$?
    set -e

    if [ "$source_verify_status" -ne 0 ]; then
      if [ "$source_verify_status" -ne 11 ] \
        && ! curl \
          --silent \
          --show-error \
          --fail \
          --location \
          --connect-timeout 2 \
          --max-time 5 \
          --retry 0 \
          --output /dev/null \
          "https://api.github.com/rate_limit"; then
        echo "warning: staged GitHub sources could not be verified while offline; continuing" >&2
      else
        echo "error: staged GitHub sources are inconsistent or invalid" >&2
        exit "$source_verify_status"
      fi
    fi
  fi

  staged_nix=$(printf '%s\n' "$staged_files" | grep '\.nix$' || true)
  nix_changes_staged=$(
    git diff --cached --name-only --diff-filter=ACMRD \
      | grep '\.nix$' \
      || true
  )
  [ -z "$nix_changes_staged" ] && return 0

  if [ -n "$staged_nix" ]; then
    echo "==> nixfmt --check"
    while IFS= read -r file; do
      nixfmt --check "$staged_tree/$file"
    done <<<"$staged_nix"
  fi

  echo "==> statix check (whole repo)"
  (
    cd "$staged_tree"
    statix check .
  )

  echo "==> deadnix --fail (excluding nvfetcher output)"
  (
    cd "$staged_tree"
    deadnix --fail --exclude ./_sources/generated.nix .
  )

  echo "==> nix flake check --no-build"
  nix flake check "path:$staged_tree" --no-build
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

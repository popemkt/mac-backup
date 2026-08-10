#!/usr/bin/env bash
#
# scripts/check-kb-assets-backup.sh
#
# Guard durable backup ownership for kb opaque media (`.kb/assets`).
#
# kb node text can reference media as `![alt](assets/x.png)`; the binaries
# live in `.kb/assets/`, which is gitignored (never committed) and owned by a
# Mackup backup decision declared in modules/darwin/home-manager/mackup.nix.
# This script proves two invariants and reports runtime coverage:
#
#   check        Static regression over the working tree; exit 1 on violation.
#                  - coverage: the Mackup `kb` app still declares
#                    `.dotfiles/.kb/assets`, `.gitignore` still ignores
#                    `.kb/assets`, and docs/backup-strategy.md still documents
#                    the directory.
#                  - refs: every media reference in committed `.kb/nodes.jsonl`
#                    resolves under `.kb/assets/`, so no committed reference can
#                    silently point at unowned state.
#   status       Runtime snapshot of the local media dir vs the iCloud Mackup
#                storage. Prints PASS:/WARN:/INFO: tagged lines for the drift
#                audit (scripts/audit-system-discrepancies.sh). Always exits 0.
#   --self-test  Prove `check` and `status` against inline fixtures; exit
#                non-zero on any failure.
#
# Exit codes: 0 clean, 1 violation, 2 usage error.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: check-kb-assets-backup.sh <check|status|--self-test>

  check        Static regression over the working tree; exit 1 on violation.
  status       Runtime local-vs-iCloud snapshot; prints PASS:/WARN:/INFO: lines.
  --self-test  Run the check/status fixtures and exit non-zero on any failure.

Env:
  KB_ASSETS_ROOT  Repo root to check (default: git toplevel, else script dir).
EOF
}

resolve_root() {
  if [ -n "${KB_ASSETS_ROOT:-}" ]; then
    ROOT_DIR="$(cd "$KB_ASSETS_ROOT" && pwd)"
  else
    ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -z "$ROOT_DIR" ]; then
      ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    fi
  fi

  MACKUP_NIX="$ROOT_DIR/modules/darwin/home-manager/mackup.nix"
  GITIGNORE="$ROOT_DIR/.gitignore"
  BACKUP_DOC="$ROOT_DIR/docs/backup-strategy.md"
  NODES="$ROOT_DIR/.kb/nodes.jsonl"
}

# Home-relative media path declared by the Mackup `kb` app, e.g.
# `.dotfiles/.kb/assets`. Empty when the declaration is missing.
declared_media_path() {
  [ -f "$MACKUP_NIX" ] || return 0
  awk '
    /applications\/kb\.cfg/ { block=1; next }
    block && /^[[:space:]]*\x27\x27/ { block=0; next }
    block && /\[configuration_files\]/ { files=1; next }
    block && files && NF { print $1; exit }
    { next }
  ' "$MACKUP_NIX" 2>/dev/null || true
}

# Storage engine declared in the rendered .mackup.cfg (always `icloud` here).
storage_engine() {
  [ -f "$MACKUP_NIX" ] || return 0
  awk '
    /file\."\.mackup\.cfg"/ { block=1; next }
    block && /^[[:space:]]*\x27\x27/ { block=0; next }
    block && /engine[[:space:]]*=/ { print $3; exit }
    { next }
  ' "$MACKUP_NIX" 2>/dev/null || true
}

# True when the `kb` app is on the [applications_to_sync] allowlist.
kb_in_sync_list() {
  [ -f "$MACKUP_NIX" ] || return 1
  awk '
    /\[applications_to_sync\]/ { sync=1; next }
    sync && /^[[:space:]]*kb[[:space:]]*$/ { found=1 }
    sync && /^\[/ { sync=0 }
    END { exit found ? 0 : 1 }
  ' "$MACKUP_NIX" 2>/dev/null
}

# Media reference targets extracted from committed node text. Only the
# documented forms count: markdown `](assets/...)` and HTML `src`/`href`
# attributes. JSONL stores quotes backslash-escaped, so normalize `\"` to `"`
# first — the extraction never writes back.
media_refs() {
  [ -f "$NODES" ] || return 0
  perl -pe 's/\\"/"/g' "$NODES" \
    | grep -oE '\(assets/[^)]*\)|(src|href)=["'"'"']assets/[^"'"'"']*["'"'"']' \
    | sed -E 's/^\(//; s/\)$//; s/^(src|href)=["'"'"']//; s/["'"'"']$//' \
    | sort -u || true
}

# Every committed `assets/...` reference must stay inside the owned
# `.kb/assets/` namespace: no parent-directory escapes, no backslashes, no
# scheme-like `//`.
check_node_refs() {
  local rc=0 target
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    case "$target" in
      *'..'* | *'\\'* | *'//'*)
        echo "FAIL: node media reference escapes owned .kb/assets/: $target"
        rc=1
        ;;
    esac
  done < <(media_refs)
  return "$rc"
}

check() {
  local rc=0 media_rel
  media_rel="$(declared_media_path || true)"

  if [ -z "$media_rel" ]; then
    echo "FAIL: no kb media path is declared in $MACKUP_NIX"
    rc=1
  elif [ "$media_rel" != ".dotfiles/.kb/assets" ]; then
    echo "FAIL: kb media path '$media_rel' does not match the repo invariant '.dotfiles/.kb/assets'"
    rc=1
  else
    echo "ok: Mackup kb app declares $media_rel"
  fi

  if kb_in_sync_list; then
    echo "ok: kb is listed in [applications_to_sync] in $MACKUP_NIX"
  else
    echo "FAIL: kb is not listed in [applications_to_sync] in $MACKUP_NIX"
    rc=1
  fi

  if grep -qx '\.kb/assets' "$GITIGNORE" 2>/dev/null; then
    echo "ok: .gitignore ignores .kb/assets"
  else
    echo "FAIL: .gitignore does not ignore .kb/assets exactly (no trailing slash)"
    rc=1
  fi

  if grep -q '\.kb/assets' "$BACKUP_DOC" 2>/dev/null; then
    echo "ok: docs/backup-strategy.md documents .kb/assets"
  else
    echo "FAIL: docs/backup-strategy.md does not document .kb/assets"
    rc=1
  fi

  check_node_refs || rc=1

  return "$rc"
}

status() {
  local media_rel local_dir storage_root storage_dir engine
  media_rel="$(declared_media_path || true)"
  if [ -z "$media_rel" ]; then
    echo "WARN: no kb media path is declared in $MACKUP_NIX; run 'check'"
    return 0
  fi

  local_dir="$HOME/$media_rel"
  engine="$(storage_engine || true)"
  if [ "$engine" != "icloud" ]; then
    echo "INFO: kb media backup uses storage engine '${engine:-unknown}'; status only supports icloud"
    return 0
  fi
  storage_root="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Mackup"
  storage_dir="$storage_root/$media_rel"

  if [ "$ROOT_DIR/.kb/assets" != "$local_dir" ]; then
    echo "WARN: mackup declares $media_rel (HOME-relative) but the repo is at $ROOT_DIR; .kb/assets is not covered on this machine"
  fi

  if [ ! -d "$storage_root" ]; then
    echo "INFO: iCloud Mackup storage not present: $storage_root"
  fi

  local local_present=0 storage_present=0
  [ -e "$local_dir" ] && local_present=1
  [ -e "$storage_dir" ] && storage_present=1

  if [ "$local_present" -eq 0 ] && [ "$storage_present" -eq 0 ]; then
    echo "INFO: no kb media locally and none in iCloud storage ($storage_dir)"
    return 0
  fi
  if [ "$local_present" -eq 0 ] && [ "$storage_present" -eq 1 ]; then
    echo "WARN: kb media is in iCloud storage but not restored locally; run 'mackup restore' ($storage_dir -> $local_dir)"
    return 0
  fi
  if [ "$local_present" -eq 1 ] && [ "$storage_present" -eq 0 ]; then
    echo "WARN: kb media exists locally but is not in iCloud storage; run 'mackup backup' ($local_dir -> $storage_dir)"
    return 0
  fi

  # Both present: compare relative file listings and per-file freshness.
  local local_files storage_files only_local only_storage stale f
  local_files="$(cd "$local_dir" && find . -type f 2>/dev/null | sort || true)"
  storage_files="$(cd "$storage_dir" && find . -type f 2>/dev/null | sort || true)"
  only_local="$(comm -23 <(printf '%s\n' "$local_files") <(printf '%s\n' "$storage_files") || true)"
  only_storage="$(comm -13 <(printf '%s\n' "$local_files") <(printf '%s\n' "$storage_files") || true)"

  if [ -n "$only_local" ]; then
    echo "WARN: kb media present locally but not in iCloud storage; run 'mackup backup'"
    printf '%s\n' "$only_local" | sed 's/^/       /'
  fi
  if [ -n "$only_storage" ]; then
    echo "WARN: kb media in iCloud storage but not restored locally; run 'mackup restore'"
    printf '%s\n' "$only_storage" | sed 's/^/       /'
  fi

  stale=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -f "$local_dir/$f" ] || continue
    [ -f "$storage_dir/$f" ] || continue
    if [ "$local_dir/$f" -nt "$storage_dir/$f" ]; then
      echo "WARN: kb media updated locally after the last backup: ${f#./} (run 'mackup backup')"
      stale=1
    fi
  done < <(comm -12 <(printf '%s\n' "$local_files") <(printf '%s\n' "$storage_files") || true)

  if [ -z "$only_local" ] && [ -z "$only_storage" ] && [ "$stale" -eq 0 ]; then
    echo "PASS: kb media matches iCloud Mackup storage ($local_dir)"
  fi
}

self_test() {
  # `fixture` is intentionally global (not local) so the EXIT trap can clean it
  # up after this function returns.
  local rc=0 got
  fixture="$(mktemp -d)"
  trap 'rm -rf "$fixture"' EXIT
  mkdir -p "$fixture/modules/darwin/home-manager" "$fixture/docs" "$fixture/.kb"
  KB_ASSETS_ROOT="$fixture"
  resolve_root

  write_fixture() {
    cat > "$fixture/modules/darwin/home-manager/mackup.nix" <<'EOF'
{ pkgs, ... }:
{
  home = {
    packages = [ pkgs.mackup ];
    file.".mackup.cfg".text = ''
      [storage]
      engine = icloud

      [applications_to_sync]
      kb
      macosx
    '';
    file.".config/mackup/applications/kb.cfg".text = ''
      [application]
      name = kb

      [configuration_files]
      .dotfiles/.kb/assets
    '';
  };
}
EOF
    printf '.kb/assets\n' > "$fixture/.gitignore"
    printf '# Backup Strategy\n\n## kb media\n\nbacked up via Mackup, .kb/assets is never committed\n' > "$fixture/docs/backup-strategy.md"
    printf '%s\n' '{"node/id":"n1","node/text":"see ![alt](assets/diagram.png) and <img src=\"assets/clip.mp4\">"}' > "$fixture/.kb/nodes.jsonl"
  }

  expect_check() {
    local want="$1" label="$2"
    shift 2
    if "$@" >/dev/null 2>&1; then got=0; else got=1; fi
    if { [ "$want" = pass ] && [ "$got" -eq 0 ]; } \
      || { [ "$want" = fail ] && [ "$got" -eq 1 ]; }; then
      echo "PASS: $label"
    else
      echo "FAIL: $label"
      rc=1
    fi
  }

  write_fixture
  expect_check pass "happy fixture passes check" check

  write_fixture
  perl -pi -e 's/^[ \t]*kb$//' "$fixture/modules/darwin/home-manager/mackup.nix"
  expect_check fail "kb dropped from applications_to_sync is rejected" check

  write_fixture
  perl -pi -e 's#\.dotfiles/\.kb/assets#.dotfiles/.kb/media#' "$fixture/modules/darwin/home-manager/mackup.nix"
  expect_check fail "declared media path moved is rejected" check

  write_fixture
  printf 'not-the-assets-line\n' > "$fixture/.gitignore"
  expect_check fail ".gitignore coverage removed is rejected" check

  write_fixture
  printf '# Backup Strategy\n' > "$fixture/docs/backup-strategy.md"
  expect_check fail "backup doc coverage removed is rejected" check

  write_fixture
  printf '%s\n' '{"node/id":"n1","node/text":"![bad](assets/../escape.png)"}' > "$fixture/.kb/nodes.jsonl"
  expect_check fail "parent-dir escape in node ref is rejected" check

  write_fixture
  printf '%s\n' '{"node/id":"n1","node/text":"<img src=\"assets/../../etc/passwd\">"}' > "$fixture/.kb/nodes.jsonl"
  expect_check fail "src parent-dir escape in node ref is rejected" check

  # status: matching media reports PASS.
  mkdir -p "$fixture/home/Library/Mobile Documents/com~apple~CloudDocs/Mackup/.dotfiles/.kb/assets"
  mkdir -p "$fixture/home/.dotfiles/.kb/assets"
  printf 'a' > "$fixture/home/.dotfiles/.kb/assets/one.png"
  printf 'a' > "$fixture/home/Library/Mobile Documents/com~apple~CloudDocs/Mackup/.dotfiles/.kb/assets/one.png"
  if HOME="$fixture/home" status | grep -q '^PASS: kb media matches'; then
    echo "PASS: status reports in-sync media"
  else
    echo "FAIL: status did not report in-sync media"
    rc=1
  fi

  # status: local-only media warns.
  printf 'b' > "$fixture/home/.dotfiles/.kb/assets/local-only.png"
  if HOME="$fixture/home" status | grep -q '^WARN: kb media present locally but not in iCloud'; then
    echo "PASS: status flags local-only media"
  else
    echo "FAIL: status did not flag local-only media"
    rc=1
  fi

  return "$rc"
}

resolve_root

case "${1:-}" in
  check) check ;;
  status) status ;;
  --self-test) self_test ;;
  -h | --help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac

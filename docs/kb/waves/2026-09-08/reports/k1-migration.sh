#!/usr/bin/env bash
#
# Wave k1 — migrate the committed kb stores to "kinds are not tags".
#
# Six supertags named no concept and are retired by this wave; the code that
# read them is already gone, so this moves the DATA to the carriers the code
# now reads (docs/kb/waves/2026-09-08/plan.md, DESIGN.md → Kinds, roles and
# options).
#
#   sys.tag.field-type      → the six sys.ft.* become children of sys.f.fieldType
#   sys.tag.query           → sys.f.query alone marks a query node
#   sys.tag.ref             → sys.f.ref.target alone marks a contextual reference
#   #enforcement-level      → the six values become children of field `enforcement`
#   #check-surface          → `surface`.targetQuery selects those children minus `prose`
#   #pinned                 → nothing to do: no node in either store carries it
#
# `.kb/nodes.jsonl` is never hand-edited: every step below is a CLI invocation,
# so the change goes through the same validation, tx log and canonical writer
# any other edit does. `--force` is passed only where a step touches a `sys.*`
# node, which is exactly what this wave retires.
#
# Re-runnable on a rebased tree: each step is guarded on the store's current
# contents, so a step that has already been applied is skipped out loud rather
# than failing or double-applying. The reparenting of `sys.ft.*` is not a step
# at all — `ensureSystemSeed` adopts seed-declared children that nothing
# parents, so it happens on the first CLI call below.
#
# Usage: docs/kb/waves/2026-09-08/reports/k1-migration.sh
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
cli="$repo_root/tools/kb/packages/app/cli/src/main.ts"

# The two committed stores: the repo's own kb, and the demo store under tools/kb.
ROOTS=("$repo_root" "$repo_root/tools/kb")

kb() { bun "$cli" --root "$root" "$@"; }
store() { printf '%s/.kb/nodes.jsonl' "$root"; }
have() { grep -qF -- "$1" "$(store)"; }
step() { printf '  %s\n' "$*"; }
skip() { printf '  · already done: %s\n' "$*"; }

# ── ids ────────────────────────────────────────────────────────────────────
FT_OPTIONS=(sys.ft.text sys.ft.number sys.ft.date sys.ft.url sys.ft.checkbox sys.ft.ref)
FIELD_TYPE_TAG=sys.tag.field-type
QUERY_TAG=sys.tag.query
REF_TAG=sys.tag.ref

ENFORCEMENT_FIELD=01M1M01PMXYSBVR4WARCA9GH12
ENFORCEMENT_TAG=01M1M028WWE79KKKEC9Z4P48ZK
SURFACE_FIELD=01M1TAKRTZ4YK5E39S8QB0226R
SURFACE_TAG=01M1TAKPSZQJQBR9SNFEX9NXAE
# Declared order, which becomes the option order the picker shows.
ENFORCEMENT_VALUES=(
  01M1M02F3T1P5JHMJ17Q0363XP # prose
  01M1M02FAXCWC0SY5NDDXE4VSB # lint
  01M1M02FHZ8QF5QJ8R535G37KY # tsc
  01M1M02FRDR686VP0WN17KTDX2 # harness
  01M1M02FYYCPM96Q09G3SM2EBS # hook
  01M1M02G5M43DP8QW7HK9JB0VS # ci
)

# `surface` = the enforcement field's children, minus the one that means
# "nothing checks it". A query over the option set, not a second copy of it.
SURFACE_QUERY="[:find ?id :where [?p :node/id \"$ENFORCEMENT_FIELD\"] [?p :node/child ?c] [?p :node/child-order ?o] [?c :node/id ?id] [?c :node/text ?t] [(not= ?t \"prose\")]]"

# Every node whose kind slot names $1, one id per line.
carriers_of() {
  kb --json query \
    "[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id \"$1\"] [?n :node/id ?id]]" |
    sed -n 's/^ *"\([0-9A-Za-z._-]*\)"$/\1/p'
}

# Drop `$2` from every node's kind slot, then delete the tag node itself.
retire_tag() {
  local tag="$1" label="$2"
  if ! have "\"$tag\""; then
    skip "$label"
    return
  fi
  local id
  for id in $(carriers_of "$tag"); do
    step "untag $id ($label)"
    kb unset "$id" sys.f.type "$tag" --type ref --force >/dev/null
  done
  step "delete tag node $tag ($label)"
  kb rm "$tag" --force >/dev/null
}

for root in "${ROOTS[@]}"; do
  printf '\n== %s\n' "$root"

  # 1. Field types: options are the field's children, so the tag has no job.
  #    (`sys.f.fieldType` also stops declaring a targetTag — the children ARE
  #    the declaration, and two declarations would answer one question twice.)
  if have "\"sys.f.targetTag\":[{\"t\":\"ref\",\"v\":\"$FIELD_TYPE_TAG\"}]"; then
    step "drop sys.f.fieldType targetTag → $FIELD_TYPE_TAG"
    kb unset sys.f.fieldType sys.f.targetTag "$FIELD_TYPE_TAG" --type ref --force >/dev/null
  else
    skip "sys.f.fieldType targetTag"
  fi
  retire_tag "$FIELD_TYPE_TAG" "field-type"

  # 2. Query and reference: the field is the kind.
  retire_tag "$QUERY_TAG" "query"
  retire_tag "$REF_TAG" "ref"

  # 3. Enforcement levels: the `enforcement` field's children.
  if have "\"id\":\"$ENFORCEMENT_FIELD\""; then
    for id in "${ENFORCEMENT_VALUES[@]}"; do
      if grep -qF "\"id\":\"$ENFORCEMENT_FIELD\"" "$(store)" &&
        grep -F "\"id\":\"$ENFORCEMENT_FIELD\"" "$(store)" | grep -qF "\"$id\""; then
        skip "reparent $id"
        continue
      fi
      step "reparent $id under enforcement"
      kb mv "$id" "$ENFORCEMENT_FIELD" >/dev/null
    done

    if have "\"sys.f.targetTag\":[{\"t\":\"ref\",\"v\":\"$ENFORCEMENT_TAG\"}]"; then
      step "drop enforcement targetTag → enforcement-level"
      kb unset "$ENFORCEMENT_FIELD" sys.f.targetTag "$ENFORCEMENT_TAG" --type ref >/dev/null
    else
      skip "enforcement targetTag"
    fi
    retire_tag "$ENFORCEMENT_TAG" "enforcement-level"

    # 4. Check surfaces: a subset of the same children, expressed as a query.
    if have "\"sys.f.targetTag\":[{\"t\":\"ref\",\"v\":\"$SURFACE_TAG\"}]"; then
      step "drop surface targetTag → check-surface"
      kb unset "$SURFACE_FIELD" sys.f.targetTag "$SURFACE_TAG" --type ref >/dev/null
    else
      skip "surface targetTag"
    fi
    retire_tag "$SURFACE_TAG" "check-surface"

    if have "\"sys.f.targetQuery\"" && grep -F "\"id\":\"$SURFACE_FIELD\"" "$(store)" | grep -qF 'sys.f.targetQuery'; then
      skip "surface targetQuery"
    else
      step "set surface targetQuery → enforcement's children minus prose"
      kb field target-query "$SURFACE_FIELD" "$SURFACE_QUERY" >/dev/null
    fi
  else
    skip "rule/check data (not in this store)"
  fi
done

printf '\nmigration complete\n'

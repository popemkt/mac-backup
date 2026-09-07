#!/usr/bin/env bash
#
# Wave g1 — migrate the committed kb stores to "kinds are not tags" for the
# graph option sets.
#
# Two supertags named no concept and are retired by this wave; the code that
# read them is already gone, so this moves the DATA to the carriers the code
# now reads (docs/kb/waves/2026-09-09/plan.md, DESIGN.md → Kinds, roles and
# options).
#
#   #graph-renderer  → the five sys.graph.renderer.* become children of
#                      sys.f.lens.renderer, which drops its targetTag
#   #graph-source    → the ten sys.graph.source.* become children of the
#                      sys.graph.sources list, each carrying its `kind`, and
#                      the five source-selecting lens fields each declare a
#                      targetQuery over that list narrowed to one kind
#
# `.kb/nodes.jsonl` is never hand-edited: every step below is a CLI invocation,
# so the change goes through the same validation, tx log and canonical writer
# any other edit does. `--force` is passed only where a step touches a `sys.*`
# node, which is every node this wave moves.
#
# Re-runnable on a rebased tree: each step is guarded on the store's current
# contents, so a step that has already been applied is skipped out loud rather
# than failing or double-applying. Three of the steps are usually *already*
# skipped by the time they run, and that is by design rather than by accident:
# `ensureSystemSeed` seeds `sys.graph.sources` with its ten children declared,
# adopts the five renderer options that nothing parents, and fills seed prop
# keys an existing node has never carried (`kind` on the ten options, the five
# `targetQuery`s) — all on the FIRST CLI call below. What is left for this
# script is exactly what that pass will not do: remove props that already have
# a value (the fifteen kind refs, `lens.renderer`'s targetTag) and delete the
# two tag nodes.
#
# The five queries are read back from `graph-schema.ts` rather than written out
# here, so this script cannot come to disagree with the seed about them.
#
# Usage: docs/kb/waves/2026-09-09/reports/g1-migration.sh
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)
cli="$repo_root/tools/kb/packages/app/cli/src/main.ts"

# The two committed stores: the repo's own kb, and the demo store under tools/kb.
ROOTS=("$repo_root" "$repo_root/tools/kb")

kb() { bun "$cli" --root "$root" "$@"; }
store() { printf '%s/.kb/nodes.jsonl' "$root"; }
have() { grep -qF -- "$1" "$(store)"; }
node_has() { grep -F "\"id\":\"$1\"" "$(store)" | grep -qF -- "$2"; }
step() { printf '  %s\n' "$*"; }
skip() { printf '  · already done: %s\n' "$*"; }

# ── ids ────────────────────────────────────────────────────────────────────
RENDERER_TAG=sys.tag.graph-renderer
SOURCE_TAG=sys.tag.graph-source
RENDERER_FIELD=sys.f.lens.renderer
SOURCES_ROOT=sys.graph.sources
KIND_FIELD=sys.f.graph.source.kind

# field<TAB>edn for the five source-selecting lens fields, derived from the one
# declaration the seed uses (GRAPH_SOURCE_FIELD_KINDS + graphSourceTargetQuery).
source_queries() {
  (cd "$repo_root/tools/kb" && bun -e '
    import {
      GRAPH_SOURCE_FIELD_KINDS,
      graphSourceTargetQuery,
    } from "./packages/domain/model/src/graph-schema.ts";
    for (const [field, kind] of Object.entries(GRAPH_SOURCE_FIELD_KINDS)) {
      console.log(`${field}\t${graphSourceTargetQuery(kind)}`);
    }
  ')
}

# id<TAB>kind-option-id for the ten source options, same single declaration.
source_kinds() {
  (cd "$repo_root/tools/kb" && bun -e '
    import {
      GRAPH_SOURCE_KIND_OPTION_IDS,
      GRAPH_SOURCE_VALUES,
    } from "./packages/domain/model/src/graph-schema.ts";
    for (const value of Object.values(GRAPH_SOURCE_VALUES)) {
      console.log(`${value.id}\t${GRAPH_SOURCE_KIND_OPTION_IDS[value.kind]}`);
    }
  ')
}

# Every node whose kind slot names $1, one id per line.
carriers_of() {
  kb --json query \
    "[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id \"$1\"] [?n :node/id ?id]]" |
    sed -n 's/^ *"\([0-9A-Za-z._-]*\)"$/\1/p'
}

# Drop `$1` from every node's kind slot, then delete the tag node itself.
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

  # 0. One CLI call so `ensureSystemSeed` runs before anything is inspected:
  #    it seeds sys.graph.sources + the kind field and its four options, adopts
  #    the orphaned renderer options, and fills the absent `kind` / targetQuery
  #    props. Everything below is then about what it deliberately leaves alone.
  kb --json query '[:find ?id :where [?n :node/id ?id] [(= ?id "sys.field")]]' >/dev/null

  # 1. Renderers: the options are `lens.renderer`'s children, so the tag has no
  #    job — and the field stops declaring a targetTag, because the children ARE
  #    the declaration and two declarations would answer one question twice.
  if node_has "$RENDERER_FIELD" '"sys.f.targetTag"'; then
    step "drop $RENDERER_FIELD targetTag → $RENDERER_TAG"
    kb unset "$RENDERER_FIELD" sys.f.targetTag "$RENDERER_TAG" --type ref --force >/dev/null
  else
    skip "$RENDERER_FIELD targetTag"
  fi
  retire_tag "$RENDERER_TAG" "graph-renderer"

  # 2. Sources: one list, five views of it. Parenting and the `kind` prop are
  #    the seed's job (step 0); what is left is retiring the tag.
  if node_has "$SOURCES_ROOT" '"children":['; then
    step "$SOURCES_ROOT parents its options (seeded)"
  else
    printf '  ! %s missing — seed did not run\n' "$SOURCES_ROOT" >&2
    exit 1
  fi

  while IFS=$'\t' read -r option kind; do
    if node_has "$option" "\"$KIND_FIELD\""; then
      skip "kind on $option"
      continue
    fi
    step "set kind on $option → $kind"
    kb set "$option" "$KIND_FIELD" "$kind" --type ref --force >/dev/null
  done < <(source_kinds)

  retire_tag "$SOURCE_TAG" "graph-source"

  # 3. Each source-selecting lens field narrows the shared list to its kind.
  while IFS=$'\t' read -r field edn; do
    if node_has "$field" '"sys.f.targetQuery"'; then
      skip "$field targetQuery"
      continue
    fi
    # `kb field target-query` has no --force and every one of these is a
    # sys.* node, so the generic setter carries the same write through the
    # same plan with admission granted.
    step "set $field targetQuery"
    kb set "$field" sys.f.targetQuery "$edn" --type str --force >/dev/null
  done < <(source_queries)
done

printf '\nmigration complete\n'

# kb wave 2026-09-08 — kinds are not tags

Coordinator: claude (this session). Base: `main` @ `49500c4`. One worker.

## Owner directive (2026-09-06, verbatim)

> "I'm a little against making every thing tag, can we make them just fields
> and stuff as well? since supertag usually embodies something/concept/object"

> "in tana you can just do nodes and it can be options and stuff, instead of
> having to have supertags for example. I don't want everything to be
> supertags, if that makes sense."

## Decision

**A supertag says what a node *is*. A behaviour is a field. An option set is
children.** Test before minting a tag: strip the behaviour — is the node still
that thing? A `#gap` without `expected` is not a gap → tag. A `#ref` without a
target is a plain node → field. `lint` is not "a check-surface", it is one of
the values `surface` may take → child of the field.

| today | verdict | becomes |
|---|---|---|
| `#ref` + `sys.f.ref.target` | role | `sys.f.ref.target` present ⇒ contextual reference |
| `#query` + `sys.f.query` | role | `sys.f.query` present ⇒ query node |
| `#pinned` (user tag minted on first pin) | membership | children of a seeded `Pinned` node, each an ordinary contextual reference |
| `#enforcement-level` on `prose lint tsc harness hook ci` | option set | children of field `enforcement` |
| `#check-surface` on the same five | option set | `surface` field's options derived from those children, minus `prose` |
| `#field-type` on `sys.ft.*` | option set | children of field `sys.f.fieldType` |
| `#ontology` `#graph-perspective` `#rule` `#gap` `#check` `#todo` `#tag` `#field` | things | unchanged |

Mechanism, not special cases: `sys.f.targetQuery` is already the general form
of "which nodes may this ref field name" and `targetTag` is one shape of it.
"Children of node X" is a second shape. One resolver derives one query from
whichever the field declares; nothing else learns a new rule.

## Waves

| id | brief | harness | branch | status |
|---|---|---|---|---|
| k1 | `briefs/k1-kinds-not-tags.md` | claude opus | `feature/kb-k1-kinds` | merged ff `e4a03c9` — reviewer MERGE, no findings; report `reports/k1.md` |

## Not this wave

- Contextual-reference follow-ups named in DESIGN-UI (breadcrumb, inline
  contextual children under backlinks, global ⌘K two-step).
- Ontology parked list (r5 §2.9). Todo F close/split — owner call.
- Whether user-defined option sets get a UI gesture beyond "add a child under
  the field node". They get exactly that, and the picker reads it.

## Close-out (2026-09-07)

- Six supertags retired: `#ref`, `#query`, `#field-type`, `#enforcement-level`,
  `#check-surface`, `#pinned`. Readers now read the field or the parent. Two
  old readers were wrong, not just redundant (tag matched by *name* off the
  display badge array; `#ref` required alongside the target) — both pinned by
  tests now.
- Resolver: `allowedRefIdsOf` precedence `targetQuery` > `targetTag` >
  field children > unrestricted; children derived to EDN, same runner.
- Worker calls accepted at review: Pinned list is `pinned` not `sys.pinned`
  (write guard); `togglePin` allows `sys.*` targets (a ref is not a write);
  `ensureSystemSeed` adopts orphaned seed children (structural pass, not a
  one-shot); `surface` keeps a `targetQuery` (subset of another field's
  children); `#rule` enforcement honestly `prose`.
- Migration script `reports/k1-migration.sh` idempotent; type refs to retired
  tags 21→0 (`.kb`) and 7→0 (`tools/kb/.kb`); untouched nodes byte-identical.
- Gates on merged tip: verify green (typecheck 21 projects, lint 0 errors,
  497 bun / 608 UI / 68 harness, `kb checks: clean`, docs clean).
- Coordinator fix-up: one unused shell array dropped from the migration
  script (`e4a03c9`).
- Not pushed. No rebuild.

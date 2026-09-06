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
| k1 | `briefs/k1-kinds-not-tags.md` | claude opus | `kb-k1-kinds` | dispatched |

## Not this wave

- Contextual-reference follow-ups named in DESIGN-UI (breadcrumb, inline
  contextual children under backlinks, global ⌘K two-step).
- Ontology parked list (r5 §2.9). Todo F close/split — owner call.
- Whether user-defined option sets get a UI gesture beyond "add a child under
  the field node". They get exactly that, and the picker reads it.

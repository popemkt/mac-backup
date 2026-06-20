# Code Unit Cohesion & Clean Boundaries

Source of truth for the cohesion rule. Apply at every radius before splitting or merging units.

---

## Principle

One thing, at one level of abstraction, through a stable surface.

Four radii — **all four must hold**:

| Radius | Question | Bad tell |
|---|---|---|
| **Cohesion** | Does this unit have one responsibility? | Reviewer must list multiple unrelated exceptions to name it |
| **Composed method / SLAP** | Does the body narrate one abstraction level as named steps? | Step-comments (`// Step 3:`), inline parsing/computation mixed into an orchestrator |
| **Clean abstraction** | Does the surface hide its internals? Depend on interface, not impl? | Callers reach past the surface into internals |
| **Modular design** | Is coupling loose across units? | Fan-in explosion, circular imports, sibling units importing each other's internals |

The mechanism: make a boundary violation **unrepresentable** (L1 hard gate), not just reviewable.

---

## Composed Method / SLAP

A body should read like the spec procedure — a flat sequence of named steps, each at the same altitude.

**Good shape:**
```ts
async function processOrder(order: Order) {
  const validated = await validateOrder(order);
  const priced = await applyPricing(validated);
  const confirmed = await reserveInventory(priced);
  return await notifyCustomer(confirmed);
}
```
- Flat. Low complexity. Each call names a step.
- Long body is **not** a smell by itself if it's a flat composed sequence.

**Bad shape:**
```ts
async function processOrder(order: Order) {
  // Step 1: validate
  if (!order.items || order.items.length === 0) throw new Error('empty');
  const total = order.items.reduce((s, i) => s + i.price * i.qty, 0);
  if (total <= 0) throw new Error('zero total');
  // Step 2: price
  const discount = order.customer.tier === 'gold' ? 0.1 : 0;
  ...
}
```
- Step-comments = steps wanting names → extract to named functions.
- Inline field-walking and computation inside an orchestrator = wrong level.

**SLAP tells:**
- A step-comment (`// Step N:`) → name it, extract it
- High `complexity`/`max-depth` in an orchestrator (not high line count) → logic that should drop a level
- Inline computation/parsing mixed into coordination → extract to named step
- Branching *at the body's own level* (guard clauses, route-by-status) is **fine** — do not flag it

Shared sub-logic across steps → named unit one level down (reuse surfaced, not duplicated). Counterweight: **MERGE** verdict catches over-extraction.

---

## Three Enforcement Layers

| Layer | Catches | Enforcement | Gates? |
|---|---|---|---|
| **L1 — structural gates** | Cross-unit boundary leaks | ESLint/linter `error` | Yes, hard |
| **L2 — smell sensors** | Within-unit responsibility creep (size/complexity) | Linter `warn` | No, advises |
| **L3 — cohesion reviewer** | Semantic cohesion lint cannot measure | LLM advisory | No, recommends |

L2 flags "maybe too much here"; human decides split-or-keep. L3 opines on "is it one thing?". L1 locks a boundary once decided. They do not overlap.

### L1 — Structural Gates

Enforce via linter `no-restricted-imports` or equivalent (Nx `@nx/enforce-module-boundaries` when libs are tagged).

Hard rules:
- routes → services, not repositories
- services → repositories + shared types, not HTTP framework
- browser code → API client, not server modules
- shared libs → other shared libs, not app internals

Once a boundary is decided: wire it as a lint `error` so it is unrepresentable going forward.

### L2 — Smell Sensors (warn-only)

Start loose — flag only genuine god-units. Ratchet down quarterly.

| Sensor | Threshold | Signal |
|---|---|---|
| Cyclomatic complexity | 20 | Best proxy for branching responsibility |
| Nesting depth | 5 | Tangled control flow |
| Nested callbacks | 4 | Async creep |
| Function length | 120 lines | Weakest — pure canary |
| File length | 900 lines | God-file canary |
| Parameters | 5 | Missing type or doing too much |

All `warn`. None block merge. **A long flat composed orchestrator is exempt** — disable the line-count rule per-method with an inline comment + explanation, keep `complexity`/`max-depth` live.

**L2 is necessary, not sufficient.** A 30-line function doing three unrelated things scores clean on every metric. That gap is what L3 fills.

### L3 — Advisory Cohesion Reviewer

Rubric — one verdict per changed unit:

| Verdict | Meaning | Action |
|---|---|---|
| **KEEP** | Single, coherent responsibility | None |
| **PROMOTE** | Cohesive unit living inline → deserves its own module/lib/public barrel | Extract + formalize API |
| **SPLIT** | Two+ responsibilities tangled | Split by named responsibility |
| **MERGE** | Fragment caused by over-extraction | Fold back into caller or neighbor |

**Shape lens (SLAP):** also judge whether the body narrates one abstraction level. Step-comments, inline computation, high complexity in an orchestrator → SPLIT. Over-extracted helpers that add indirection with no named step → MERGE.

**Report format:**
```
COHESION REVIEW
<file> — <KEEP|PROMOTE|SPLIT|MERGE> (<confidence>)
  evidence: <imports, callers, touched responsibilities>
  action: <concrete next step>

counts: KEEP=<n> PROMOTE=<n> SPLIT=<n> MERGE=<n>
COHESION_STATUS: CLEAN | ISSUES(<n>)
```

Lead with `⚠ COHESION: N ISSUES — ACTION REQUIRED` when any verdict is SPLIT/MERGE/leak.
End with machine-parseable `COHESION_STATUS: CLEAN` or `COHESION_STATUS: ISSUES(<n>)`.

**Grounding — every claim must cite evidence:**
- Changed files from `git diff --name-only <base>...HEAD`
- Direct imports from the file (fan-out)
- Ripgrep fan-in: who imports this file or its exports
- Relevant tests covering the unit

No "feels coupled" without a file/import/test anchor.

**The reviewer is loud but the consumer gates.** Non-deterministic LLM verdicts should not auto-block CI — prefer "required human review on ISSUES". The deterministic hard gate stays L1.

---

## The Loop

```
L3 LLM reviewer ──"X is a complete unit (PROMOTE)"──► human promotes X to lib/module
(semantic, soft)                                              │
                                                             ▼
                                    L1 boundary lint locks it forever (hard)
                                    — "reach into X's internals" is now unrepresentable
```

Soft semantic discovery → hard mechanical permanence. LLM *finds* the boundary; linter *enforces* it.

---

## Decision Records

- **Size as signal, boundary as gate.** Hard size caps force bad splits that lower cohesion. Size sensors stay `warn`; only boundary violations block.
- **L3 advisory, not gating.** Non-determinism violates fail-fast. A flaky gate erodes trust faster than it adds value.
- **SLAP/composed method is a first-class radius.** A flat 200-line orchestrator that reads like the spec procedure is correct. A 40-line function with step-comments and inline computation is wrong. Line count is the weakest signal; altitude is the real one.

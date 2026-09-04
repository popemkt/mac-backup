# Brief r1-effect-plan — is Effect load-bearing here, and what would finishing it cost?

Harness: cursor. Protocol:
`docs/kb/waves/2026-08-24/briefs/impl-protocol.md` (gate + handoff sections;
the verification section does not apply, you write no code).

## THIS IS RESEARCH ONLY

The owner's instruction was: *"are we using effect throughout. If not, plan
something, don't do it yet."*

**Write no source code. Change no configuration. Add no dependency. Your only
output is one document.** If you find yourself editing a file under
`tools/kb/src/` or `tools/kb/ui/src/`, you have exceeded the brief. Findings
that beg to be fixed get written down as recommendations, not commits.

Deliverable: `docs/kb/waves/2026-08-24/reports/r1-effect-plan.md`.

## Established facts (verified — do not spend budget re-deriving)

- `effect` 4.0.0-beta.106 and `@effect/platform-bun` 4.0.0-beta.106 are
  production dependencies of `tools/kb`.
- **24 of 57** files under `tools/kb/src/**/*.ts` import `effect` or
  `@effect/platform`. So Effect is roughly 42% adopted on the backend.
- **Zero** files under `tools/kb/ui/src` import Effect. The UI is React 19 +
  zustand + plain TypeScript.
- Bun is the production runtime; TS 7 + `vp` 0.2.8 own lint/check tooling.

Start from those numbers and go straight to the interesting question, which is
not "how much" but **"is the boundary in a coherent place?"**

## Part 1 — audit

Answer with file:line evidence, not impressions:

1. **Where is the Effect/non-Effect boundary, and is it a boundary or a
   frontier?** A clean design has Effect inside and `Effect.runPromise` at a
   small number of named leaves (CLI command handlers, MCP tool handlers, HTTP
   route handlers). A frontier has `runPromise` called mid-graph, so effects are
   discharged and re-wrapped repeatedly. Count and locate every `runPromise` /
   `runSync` / `runFork` and classify each as leaf or mid-graph.
2. **Is the error channel typed, or is Effect being used as a fancy Promise?**
   Look for `Effect<A, never, R>` signatures wrapping code that actually throws,
   `try/catch` inside `Effect.gen`, and `Effect.orDie` / `Effect.tryPromise`
   used to launder unknown failures. Effect's main payoff is the typed error
   channel; if that is unused, the 42% is cost without benefit and the plan
   should say so plainly.
3. **Which services/layers exist, and which are ambient instead?** Is
   `FileSystem` used consistently for store I/O, or does some path call `Bun.file`
   / `node:fs` directly? Is there a `Store` service, or is the store a module
   singleton? Ambient state is what makes the DST work (t2) hard, so this
   question has a concrete consumer.
4. **What does the non-Effect 58% consist of?** Categorise: pure functions that
   should never be effectful (`order.ts`, `field-type.ts`, parsing — these are
   correctly plain and moving them would be a mistake), versus genuinely
   effectful code sitting outside Effect (I/O, subscriptions, process
   management, the WS server).
5. **The UI.** Is Effect in the UI a good idea at all? Argue both sides
   honestly. zustand + React already own state and lifecycle; Effect's win in a
   browser is typed async orchestration for the WS/API layer, not rendering.
   A defensible answer is "no, and here is the boundary instead" — do not
   assume more Effect is automatically better.

## Part 2 — the plan

If the audit concludes adoption should complete or should stop, say which, and
then:

- **Target architecture**, concretely: the service/layer set (`Store`,
  `FileSystem`, `Clock`, `Random`, `Ws`, `Extensions`?), where the runtime is
  built, and where the leaves are.
- **Migration order**, in phases small enough to land in one wave each, each
  phase independently shippable with the four-command suite green. State what
  each phase buys — a phase whose only benefit is consistency should be labelled
  as such so the owner can decline it.
- **What must NOT move.** Be explicit. Pure core stays pure. Name the modules.
- **Interaction with `t2-dst`, which is running in parallel.** t2 is collapsing
  wall-clock time and id/randomness to a single owner, preferring Effect's
  existing `Clock`/`Random`/`TestClock` over a new capability record, and is
  producing a list of call sites it had to thread manually. **Read t2's report
  before you finalise Part 2** if it has landed; if it has not, write the plan
  so that t2's seam is its phase 0 and note the dependency. Do not duplicate
  t2's work in your plan; consume it.
- **Interaction with `t1-property-mutation`.** Effect's `TestClock` and
  deterministic runtime are DST infrastructure; note where the plan makes
  simulation easier or harder.
- **Cost and risk.** Effect 4 is on a **beta** (`4.0.0-beta.106`). Assess: API
  churn risk, what a beta bump has cost this repo before (check git history),
  bundle-size impact if it enters the UI, and the onboarding cost of Effect
  idiom for a solo-maintained repo. A plan that ignores the beta pin is not
  usable.
- **A recommendation.** One of: complete adoption, hold the current boundary and
  formalise it, or retreat. Pick one, and give the owner the two strongest
  arguments against your own pick.

## Style

The audience is the repo owner deciding whether to spend several waves on this.
Lead with the recommendation and the numbers. Bury nothing important below the
fold. Where you are guessing, say you are guessing.

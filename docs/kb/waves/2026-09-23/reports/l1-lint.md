# l1-lint — adopting outside lint rules against kb's own

Wave `l1` of `docs/kb/waves/2026-09-23/plan.md`. Harness: claude / opus.
Worked on `main` directly (single worker, no parallel wave). Commits:
`cf7058d`, `f8b63c8`, `20f03f9`, on top of `0ca5901`.

**Result.** Seven anti-slop rules vendored and at `error`; the six sites they
found fixed first; oxlint 1.76 → 1.83 with the React Compiler rules it brings
parked on the ratchet. `@shadcn/lint` measured, not adopted — it needs design
decisions this wave does not own. Gates on the tip: verify green (harness 95),
packages 508/0, UI 1055/1055, `nix build .#kb` green.

---

## The question

Two candidate rule sets, both built for agent-written code:

- [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) @ `c44ef22` —
  Oxlint JS-plugin rules against "low-evidence" TypeScript, plus an opt-in
  Effect group. Meant to be vendored, not installed.
- [shadcn-ui/lint](https://github.com/shadcn-ui/lint) @ `a89d047`
  (`@shadcn/lint` 0.2.0) — Tailwind v4 design-system rules whose messages
  tell an agent what to use instead. An npm package; needs oxlint ≥ 1.80.

Which of them add a check kb does not already have? Answered by running every
rule over the real tree, not by reading the READMEs.

## Method

Each rule set ran from a scratch directory against `tools/kb` with every other
rule off, then split by production vs test code (`/tests/`, `*.test.*`,
`tests-render/`, `harness/`). Every rule with production hits had its sites
sampled by eye. The adopted set was then re-run inside kb's real
`.oxlintrc.json` with `--type-aware`, on oxlint 1.76 (kb's) and 1.85 (latest),
to separate "the plugin works here" from "a toolchain bump is needed".

## anti-slop — measured

| rule | all | prod | verdict |
|---|---:|---:|---|
| `require-readable-spacing` | 5304 | — | reject: blank-line taste, formatter territory |
| `require-safety-comment-for-type-assertion` | 407 | 27 | reject: duplicate (below) |
| `no-shape-in-symbol-names` | 203 | 152 | reject: would flag kb's own `workspace-shape` |
| `no-runtime-typeof` | 144 | 102 | reject: kb narrows `unknown` at parse boundaries by design |
| `no-unknown-parameters` | 102 | 86 | reject: flags exactly the boundaries that should take `unknown` |
| `no-known-value-widening` | 78 | 62 | reject: taste |
| `no-chained-type-assertions` | 75 | 2 | reject: duplicate (below) |
| `no-unsafe-dictionary-type` | 70 | 25 | reject: taste |
| `no-conditional-empty-object-spread` | 52 | 44 | reject: it is kb's `exactOptionalPropertyTypes` idiom |
| `no-unknown-returns` | 37 | 31 | reject: ports like `KbIndex.pull` are `unknown` by contract |
| `no-array-filter-map` | 22 | 16 | reject: perf taste |
| `prefer-effect-match` | 12 | 10 | reject: all small UI arithmetic ternaries |
| `no-module-mocking` | 11 | 0 | reject: tests only |
| `anti-slop-effect/no-manual-tag-comparison` | 2 | 2 | **adopt** |
| `no-reflect-get` | 2 | 2 | **adopt** |
| `no-object-parameters` | 2 | 2 | fixed; not vendored (pulls 300 lines of alias resolution) |
| `anti-slop-effect/no-manual-tagged-construction` | 0 | 0 | **adopt** (guard) |
| `anti-slop-effect/no-manual-effect-error-tag` | 0 | 0 | **adopt** (guard) |
| `anti-slop-effect/no-service-constructor-imports` | 0 | 0 | **adopt** (guard) |
| `no-reflect-apply` | 0 | 0 | **adopt** (guard) |
| `no-reduce-accumulator-copy` | 0 | 0 | **adopt** (guard) |

**Why the assertion rules are duplicates.** kb already runs the type-aware
`typescript/no-unsafe-type-assertion` at `error`. Both production hits of
`no-chained-type-assertions` (`ui/src/lib/caret.ts:223`,
`ui/src/components/graph/force3d-instance.ts:58`) already carry that rule's
disable with a `GAP [[…]]`. The other 73 are happy-dom test glue, a file class
kb exempts on purpose. A second, syntactic mechanism for one concept is the
duplicate Rule 1 forbids.

**Why the Effect group is worth having at zero hits.** kb's Effect style
(`Schema.TaggedError`, `catchTag`, services yielded from Layers) was held only
by `tools/kb/AGENTS.md` prose and the Effect language service, which checks
none of these. Zero hits means the code already follows it; the rules make
that stay true for the next agent.

## anti-slop — landed

**`cf7058d` — the sites first.** `isDomainError` (`model/src/errors.ts`) cast
to `{ _tag?: unknown }` and compared a string; `ensureDomainError` cast twice
to read `code`/`details`; `isNotFound` (`workspace-fs/src/errors.ts`) rebuilt
`Predicate.isTagged` from three checks; `ext-sdk/src/contribution.ts` read
`id`/`template` through `Reflect.get`. Each is now the `Predicate` that states
it, and no assertion is left in any of them. ext-check's two actions typed
their input `object`; it is now `z.infer` of the empty schema they declare,
as the other bundled extensions do.

**`f8b63c8` — the rules.** Seven rule files plus their helpers under
`tools/kb/harness/lint/anti-slop/`, with `LICENSE` and `UPSTREAM.md` (which
rules, why, and the rejected list), registered as two `jsPlugins` in the one
`.oxlintrc.json`. Placement under `harness/` is deliberate: it is root tooling
that already owns lint policy, and it is inside verify's typecheck, lint and
fmt scopes, so the vendored code meets kb's strictness rather than being
ignored the way upstream suggests. It did: kb's type-aware
`no-unnecessary-condition` found two defensive checks upstream's types prove
dead, and they were tightened.

- `@oxlint/plugins` and `oxlint` are pinned to the same exact version in the
  catalog; they move together.
- Upstream's `RuleTester` cases survive as `*.rule-cases.ts`. `RuleTester`
  parses through oxlint's raw-transfer binding, which refuses Bun, so
  `harness/tests/lint-plugin-rules.test.ts` runs each case file as a Node
  process — the Node oxlint already needs to host JS plugins at all.
- knip learns the plugin entries and case files as entries.
- A probe file with `r._tag === "Ready"` and `Reflect.get(…)` goes red, so the
  wiring is proven, not assumed.

## oxlint 1.83 — `20f03f9`

`@shadcn/lint` needs ≥ 1.80; the latest was 1.85. The 3-day
`minimumReleaseAge` in `bunfig.toml` admitted 1.83.0 (2026-09-14) and refused
1.84/1.85 (both 2026-09-21), so 1.83 it is; `oxlint-tsgolint` ^7.0.2002.

The bump turns on oxlint's React Compiler rules through the correctness and
suspicious categories, with 59 existing sites:

| rule | sites |
|---|---:|
| `react/refs` | 22 |
| `react/exhaustive-effect-dependencies` | 16 |
| `react/set-state-in-effect` | 14 |
| `react/hooks` | 4 |
| `react/memo-dependencies` | 2 |
| `react/globals` | 1 |

Mostly the imperative graph and canvas components (sigma, three, the canvas
doc hook) reading refs during render and syncing state in effects. Draining
them is behaviour work in the UI, not a toolchain change, so they went to the
ratchet lane — `warn`, counts frozen in `harness/lint-warn-baseline.json`, a
rise fails, promotion at zero — with gap `01M35NJQPKW5YVNVFFAFAYXPFH`
carrying expected / current / impact / closes. 1.85 would additionally add
`unicorn/consistent-function-scoping` (11, harness tests); 1.83 does not.

## @shadcn/lint — measured, deferred

kb's UI is plain Tailwind v4 with its own tokens and no component library,
which the tool supports. Against `packages/app/ui/src`:

| rule | hits | reading |
|---|---:|---|
| `no-arbitrary-values` | 258 | ~200 are `text-[10px]`…`text-[13px]`: an untokenized type scale |
| `no-inline-styles` | 124 | dynamic canvas/graph positioning; skip |
| `no-unknown-classes` | 21 | kb's plain CSS classes (`kb-shell`); skip |
| `no-restyle` | 16 | callers restyling kb's own `EnumSelect` / `MdView` |
| `require-static-classes` | 5 | the same two components |
| `no-raw-colors` | 5 | 3 real (amber in `graph-page.tsx:220` where `warning` exists), 2 false positives (`outline-editor` read as an outline color) |

Adoption needs two decisions this wave does not own: contracts for which of
`EnumSelect` / `MdView`'s styling callers may override, and whether the
10–13px sizes become theme tokens (then `no-arbitrary-values` holds the line).
The prerequisite — oxlint ≥ 1.80 — is now in place.

## Toolchain, for the record

Asked whether kb should "move to tsgo" as the draiver repo did: it already
has. kb runs `typescript ~7.0.2` (the Go compiler; `tsc --version` →
`7.0.2+effect-tsgo.0.40.0`), vp 0.2.8 (draiver: 0.1.24), and the same
`minimumReleaseAge` 4320. draiver's own spec (`technical-specs/11-toolchain.md`)
records that "migrate to tsgo" is exactly the TS 7 catalog bump.

## Left open

- Gap `01M35NJQPKW5YVNVFFAFAYXPFH` — drain the 59 React sites.
- `@shadcn/lint` — the two decisions above, then `no-raw-colors` and
  `no-restyle` at `error`, `no-arbitrary-values` after the tokens.
- oxlint 1.85 once it clears the release-age floor.

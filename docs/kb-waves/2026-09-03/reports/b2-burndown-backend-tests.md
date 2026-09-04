# b2-burndown-backend-tests — report

Wave `b2-burndown-backend-tests` of `docs/kb-waves/2026-09-03/plan.md`
(run log + Appendix A.5 Q1: test `no-non-null-assertion` / `strict-boolean-expressions`
after d1 drained src). Harness: cursor (grok 4.6). Branch
`feature/b2-burndown-backend-tests`, child of `kb-wave/2026-09-03` @ `c541b27`.
Scope: backend test files (`packages/*/tests/**`, `*.test.ts` outside ui, plus
`packages/render-tests/tests-render/*.e2e.ts` so backend-all promotion is honest).
`.kb/nodes.jsonl` was not touched. UI was not touched. Backend src was not
touched except `packages/harness/src/constraints.ts` (the test→test-kit
reachability the matrix did not previously name).

Final `bun run verify` (tools/kb): **green**. Harness 39 pass / 0 fail.
Backend `bun test` (excluding DST replay and the known-red 50k benchmark):
**346 pass / 0 fail**.

---

## 1. Shipped

| Rule | before (workspace warn) | after | promotion |
|---|---:|---:|---|
| `typescript/no-non-null-assertion` | 592 (201 be tests + 391 ui) | **391** (all ui) | backend-src → **backend-all** `error` |
| `typescript/strict-boolean-expressions` | 272 (27 be tests + 245 ui) | **245** (all ui) | backend-src → **backend-all** `error` |
| `typescript/no-confusing-non-null-assertion` | 2 | **0** | global `warn` → **`error`** (side-effect of removing `!`; ratchet demanded it) |

Blocking ledger: **40 → 39**. `no-unnecessary-condition` stays backend-src
(still non-zero in backend tests and ui). Size sensors unchanged
(`max-lines-per-function` stayed 75; one describe that crossed 120 was
shrunk by binding `expectDefined` once per fixture).

### Seams (one mechanism each)

- **Test narrowing.** `tools/kb/packages/test-kit/src/expect-defined.ts` —
  `expectDefined<T>(value): NonNullable<T>`. Fails the test with a clear
  message. Production code keeps `present` in `@kb/model`. Not a second
  `present()`: different audience (assertion vs invariant), different home.
- **Test-kit reachability.** Tests may import `@kb/test-kit` without making
  test-kit a production edge. `testMayImportTestKit` skips the layer/scope
  matrix and the "must declare" check for those import edges;
  `isTestKitDevDependency` skips the manifest matrix so packages whose tests
  import the helper can list it as `devDependency` (`workspace:*`) under
  bun's isolated linker. oxlint restricted-imports still forbid `@kb/test-kit`
  from `src/**`.
- **Tooling exception.** `@kb/harness` stays with zero workspace deps
  (tooling row). Its three test files import the helper by path
  (`../../test-kit/src/expect-defined.ts`) so type-aware lint sees
  `NonNullable<T>` without a manifest edge.

### Oxlint split (d1's backend-src block, widened)

d1+i1 left three rules at backend-**src** `error`. This wave splits that
block: `no-non-null-assertion` and `strict-boolean-expressions` move to a
backend-**all** glob (`packages/<be>/**`, ui excluded).
`no-unnecessary-condition` stays backend-src.

---

## 2. Cut

- UI `no-non-null-assertion` 391 and `strict-boolean-expressions` 245 — b3.
- Backend-test `no-unnecessary-condition` (2) — not this wave's two rules.
- Size sensors, Effect suggestions, Store-port tsgo — unchanged.

---

## 3. Shared-file touches

| File | Change | Why |
|---|---|---|
| `tools/kb/.oxlintrc.json` | backend-all override for the two rules; global `error` for `no-confusing-non-null-assertion` | promotion |
| `tools/kb/packages/harness/lint-warn-baseline.json` | `bun run harness:snapshot` | never hand-edited |
| `tools/kb/packages/harness/src/constraints.ts` | test→test-kit reachability | one named exception, not a per-call-site skip |
| `packages/{model,query,store-jsonl,runtime,cli,mcp,server,render-tests}/package.json` + `bun.lock` | `"@kb/test-kit": "workspace:*"` devDependency | isolated linker |
| `.kb/nodes.jsonl` | **not touched** | owner data |

---

## 4. Red-then-green evidence

Throwaway `packages/cli/tests/_b2_red_proof.ts`, then deleted. Workspace
oxlint `--quiet` exit 0 afterwards.

| Rule | Red (oxlint **Error** on the proof file) | Green |
|---|---|---|
| `typescript/no-non-null-assertion` | `Forbidden non-null assertion` on `bang!` in a backend test | be tests 0; backend-all `error` |
| `typescript/strict-boolean-expressions` | `Unexpected nullable string value in conditional` on `if (maybe)` | be tests 0; backend-all `error` |
| `typescript/no-confusing-non-null-assertion` | `Confusing combinations of non-null assertion and equal test like \`a! == b\`` | workspace 0; global `error` |
| ratchet | after the two drains, `no-confusing-non-null-assertion` at 0 failed "promote then snapshot" until the flip | snapshot matches live counts (39 blocking) |

A `!` or a nullable-string `if` in backend tests is now an oxlint **error**,
not a warning. Remaining warnings for both rules are `@kb/ui` only.

---

## 5. Per-rule before / after (workspace blocking ledger)

Before = i1 snapshot at `c541b27` (40 blocking). After = this wave's snapshot.

| Rule | i1 | after | notes |
|---|---:|---:|---|
| `typescript/no-non-null-assertion` | 592 | **391** | 201 backend-test sites drained |
| `typescript/strict-boolean-expressions` | 272 | **245** | 27 backend-test sites drained |
| `typescript/no-confusing-non-null-assertion` | 2 | *(dropped)* | promoted global error |
| `eslint/max-lines-per-function` | 75 | 75 | graph-perspective describe bound `expectDefined` once so it did not become 76 |

No rises vs i1.

---

## 6. Needs owner

| Site | Why this wave did not change it |
|---|---|
| `@kb/ui` `typescript/no-non-null-assertion` (391) and `strict-boolean-expressions` (245) | b3. Not this wave's scope. |
| `packages/model/src/present.ts` throws plain `Error` | d1 flagged; still the production narrowing helper. Tests do not call it. |
| `exactOptionalPropertyTypes` backend (~17) | data model; not mechanical. |
| `packages/**/tests/**` `typescript/no-unnecessary-condition` (2) | Q1 split left this at backend-src; not in the two-rule brief. |
| `tools/kb/packages/harness/tests/*.ts` relative import of `expect-defined.ts` | tooling layer forbids workspace deps. A barrel import would need a harness `devDependency` on `@kb/test-kit`, which is a tooling-row exception. The helper is still the one in test-kit. |
| DST replay tests (`test-kit/tests/dst.test.ts`) wall-clock flaky under load | plan Needs owner; not touched. |

---

## 7. Gaps as node ids

None written. This wave must not edit `.kb/nodes.jsonl`.

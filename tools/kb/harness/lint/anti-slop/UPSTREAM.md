# anti-slop (vendored subset)

Source: <https://github.com/dmmulroy/anti-slop> at `c44ef22` (2026-09-10),
MIT (`LICENSE`). Upstream is meant to be copied and owned, not depended on;
these files are ours from here and are linted, formatted, typechecked and
tested with the rest of `harness/`.

Only rules that add a check kb does not already have are here:

| rule                                              | why kb takes it                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `anti-slop-effect/no-manual-tag-comparison`       | `_tag ===` instead of `Predicate.isTagged` / `Match.tag`                      |
| `anti-slop-effect/no-manual-tagged-construction`  | `{ _tag: … }` literals instead of Schema / tagged constructors                |
| `anti-slop-effect/no-manual-effect-error-tag`     | `_tag` branching inside `Effect.catch` instead of `catchTag`                  |
| `anti-slop-effect/no-service-constructor-imports` | importing a service's `make*` instead of yielding it from its Layer           |
| `anti-slop/no-reflect-get`, `no-reflect-apply`    | untyped reads and calls where `Predicate.hasProperty` or a typed call says it |
| `anti-slop/no-reduce-accumulator-copy`            | copying the accumulator in a reducer (quadratic growth)                       |

Left out on purpose, measured against kb on adoption:

- `no-chained-type-assertions`, `require-safety-comment-for-type-assertion`:
  kb's type-aware `typescript/no-unsafe-type-assertion` already owns
  assertions; a second, syntactic mechanism for one concept is a duplicate.
- `prefer-effect-match`: every hit was a small arithmetic ternary in UI code,
  where `Match` is ceremony.
- `require-readable-spacing`, `no-shape-in-symbol-names`, `no-runtime-typeof`,
  `no-conditional-empty-object-spread`, `no-unknown-parameters`,
  `no-unknown-returns`, `no-unknown-type-aliases`, `no-unsafe-dictionary-type`,
  `no-known-value-widening`, `no-widen-then-assert`, `no-object-parameters`,
  `no-array-filter-map`, `no-module-mocking`: taste that conflicts with kb's
  own conventions (the exact-optional spread idiom, `unknown` at parse
  boundaries), or too little signal for the files they would add.

To take an upstream change: diff the upstream file against the one here and
port it by hand; there is no sync script.

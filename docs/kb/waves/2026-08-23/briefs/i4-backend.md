# Brief i4-backend — Abstraction hardening + extension type surface

Harness: opencode (second instance). Zone: `tools/kb/src/foundation/**`,
`src/operations/**`, `src/extensions.ts`, `src/shared/contracts.ts` if needed,
`tools/kb/package.json`, plus any SDK emission step + its tests. Protocol:
`docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

Research inputs:
1. `reports/r6-ext-sdk.md` — normative: implement its chosen design for how
   external `.kb/extensions/*.ts` authors get real types (single source of
   truth, freshness test, author walkthrough verified).
2. `reports/r4-perf.md` — CONTEXT ONLY this wave. Its Stage-0 "keep-course
   hardening" items are in scope IF cheap and safe (e.g. fsync on commit,
   write-path locking within current format). The SQLite/storage-engine
   migration is explicitly OUT of scope tonight — do not start it.

Hard constraint: HTTP/WS wire API stays backward compatible this wave; all
existing extension files keep loading; bundled docs.ts untouched behaviorally.

Audit your own zone ground-up first: half-baked abstractions get replaced,
not patched. Keep public seams small and typed.

Acceptance beyond the suite: a scratch external extension in /tmp gets full
type-checking against the shipped SDK with zero repo-relative imports, loads
at runtime, and the freshness test fails if types drift.

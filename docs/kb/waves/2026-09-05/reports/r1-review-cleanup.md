# r1 review cleanup report

Branch: `feature/r1-review-cleanup`

Commits:

- `75a71e0` — `docs(kb): correct stale paths and deleted-machinery commentary`
- `fb2015f` — `feat(kb-harness): ratchets fail on any mismatch; collectors report health; suppressions are one form`
- commit 3 — `docs(kb): gap ledger carries the review's open findings` (this report)

## Review disposition

| Review finding | Disposition |
| --- | --- |
| Action output schemas are declared but not parsed | Recorded as gap `01M1PJSSQYFV2E160JANGBPKCK`. The runtime fix remains with p1b / the next wave because `packages/app/runtime` is outside this worker's ownership. |
| `importEdges` recognizes only bare `@kb/<package>` imports | Recorded as gap `01M1PJV94AJP2SAQT50KNKNHA2`. |
| Repository `.kb/extensions` have tolerant runtime loading but no fail-closed admission | Recorded as gap `01M1PJVJX84AZCRVJ82R20WTK3`. |
| `KbContext` carries both `Store` and `EffectStore` | Recorded as gap `01M1PJVW0VZ283V1N3PDXFSHTC`. |
| Core action definitions and handlers are manually paired in `CORE_ACTIONS` | Recorded as gap `01M1PJW3WHWPCBT5BYNEQMYG98`. |
| The public extension SDK mirror is not bidirectionally compatible by type | Recorded as gap `01M1PJWF4G6W4122ZE4K67319V`. |
| UI ownership is prose-only and already crossed | Recorded as gap `01M1PJWP9Q3RGJ4SNV88R690TE`, naming seven import sites. Sanctioned `Bullet` and `NodeRow` imports are excluded. |
| Pre-commit checks the working tree rather than a staged snapshot | Recorded as gap `01M1PJWWSSRV3JGADQVYTMRGPB`. |
| `main` has no required branch protection | Recorded as gap `01M1PJXGKQ0HAYEWY2V0QPWVX1`. |
| Rule enforcement metadata is hand-typed rather than derived from `#check` | Recorded as gap `01M1PJXPBSJ6J25ZCEAX0G0AN7`. |
| Closed gaps render alongside active gaps | Fixed. The rules template now renders `status=done` gaps under `## Closed`, with an ext-docs-local red/green test. Broader gap statuses and marker-lifecycle validation remain future governance work. |
| Warning ratchets accept decreases without refreshing the baseline | Fixed. Every baseline mismatch now fails and directs the maintainer to `bun run harness:snapshot`; a partial-decrease red case protects the behavior. |
| Oxlint, Effect, and Knip collector failures can become empty finding sets | Fixed. Collectors return `{ ok, findings }`; execution or JSON-decode failure is unhealthy and fails the harness. |
| Knip runs with `--no-exit-code` and has no debt control | Fixed with the shared ratchet lane. The 73 stable Knip identities span files outside this worker's ownership, so forcing zero here would require unrelated edits; `lanes.knip` now uses the existing baseline mechanism and raw Knip no longer masks its exit status. |
| Suppression directives are inconsistent and stale | Partially fixed. Unused-disable reporting is an error and four verified stale directives were removed. The inventory is 66 directives: 56 `oxlint-*`, 10 legacy `eslint-*`, and 20 grammar violations; the repository-wide checker is intentionally skipped behind gap `01M1PHTZDZCKMXYP6HW109M3DT` until the unowned sites are rewritten. |
| Live UI path documentation is stale | Fixed in `build.ts` and `ARCHITECTURE.md`; `packages/app/server/src/http.ts:122` is left to p1b because it is outside this worker's ownership. Historical wave documents remain historical evidence. |
| Boundary commentary describes the deleted Nx/tag mechanism | Fixed to describe the import-derived package graph, the `application/` versus `app/` boundary, and why `@kb/test-kit` is an app-level composition root. |
| Generated canvas-test todo names `packages/runtime/tests` | Fixed through the Bun CLI and rematerialized as `packages/app/runtime/tests`. |
| Storybook is simultaneously installed and rejected in architecture prose | Fixed by retaining the live Storybook 10 decision and removing the stale rejection. |
| Lock-file and CI prose describe behavior that no longer exists | Fixed: `nodes.jsonl.lock` is documented as gitignored and CI lists the current Bun verification/test commands. |

Every new gap has singleton `expected`, `current`, `impact`, and `closes` values plus a typed reference to its governing `#rule`; `.kb/nodes.jsonl` was changed only through `bun tools/kb/packages/app/cli/src/main.ts` and the docs were materialized through `docs.materialize`.

## Additional finding

The acceptance grep found live stale `tools/kb/ui` paths throughout `tools/kb/kb-code-walkthrough.html`. The comprehensive review did not identify that artifact, and it is outside this brief's ownership, so it needs another owner; no edit was made. The other non-historical live hit is the expected p1b-owned `packages/app/server/src/http.ts:122`.

## Verification

- `bun run verify` — green: 17 typecheck projects, format/lint admitted, harness 60 pass / 1 intentional skip.
- `bun test packages` — green: 329 pass / 0 fail, including the new rules-template test.
- `bun run test:ui` — green: 89 files, 631 pass / 0 fail.
- `docs.check` — clean for `rules` and `todos`.
- `git diff --check` — clean.

An earlier package-suite attempt hit the review's known wall-clock benchmark sensitivity at 1064 ms versus the 1000 ms gate. Its immediate isolated rerun passed at 922 ms (328/328 at that point), and the final full package run passed with the benchmark at 454.5 ms total.

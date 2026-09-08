# Wave 2026-09-10 — the two gaps wave 2026-09-09 left at the top

Two workers, one batch, disjoint ownership. Both branch from `main` @
`e69a0ba` (wave 2026-09-09 fully merged and pushed; verify green, harness 85,
packages 483/0, UI 1052/1052). Merge order: whichever is green first;
`main` fast-forwards only when the merged tip is green.

| wave | harness | branch | gaps | owns |
|---|---|---|---|---|
| h1-ui-test-isolation | claude / opus | `kb-h1-ui-tests` | `01M1XA98A0A7PWEPMHG2T4R5GP` `01M1X8VQT1P6E45NBTQEQ96YDR` | `packages/app/ui/vite.config.ts` test block, `ui/src/test-setup.ts`, `ui/src/test-support/**`, every `*.test.ts(x)` under `ui/src`, `packages/app/test-kit/tests/dst.test.ts`, `tools/kb/package.json` test scripts, `actions/mutations.ts` **only** if the root cause is there |
| h2-text-host-primitive | cursor / grok 4.6 | `kb-h2-text-host` | `01M1RXMRJA3ZRAWPTB0ZH5YEYG` `01M1RXNGSJT2J2VHDSYY7QJSD3` | `components/outline/{field-value,node-content}.tsx`, the new `components/ui/node-text-host.tsx`, a new `stores/` binding hook, `components/canvas/canvas-card.tsx`, the six `NodeContent` importers' import lines, baseline via `harness:snapshot` on the `duplicates:` drop |

Neither worker edits `harness/src/constraints.ts`, `.oxlintrc.json`, or the
baseline by hand. h1 touches no component; h2 touches no test config. If a
fix needs the other's files, finish everything else and report the seam.

Briefs: `briefs/h1-ui-test-isolation.md`, `briefs/h2-text-host-primitive.md`.
Reports land in `reports/`.

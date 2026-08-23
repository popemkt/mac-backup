# DX polish handoff — 2026-08-23

## Findings

| Finding | Status | Evidence / outcome |
|---|---|---|
| Staged Nix admission ran `nixfmt`, `statix`, `deadnix`, and `nix flake check` serially. | Fixed | `intent/gate.sh` now runs the independent staged-snapshot checks concurrently, collects every result, and fails if any gate fails. |
| The pre-commit KB docs/typecheck paths failed or skipped without explaining that local dependencies were missing. | Fixed (DX); environment flagged | The hook now names `bun install --cwd tools/kb` (or UI equivalent) before skipping. With dependencies installed, the same docs and typecheck gates still execute and fail normally. |
| Docs referred to `modules/home.nix`, `home.nix`, and `security.pam.enableSudoTouchIdAuth`, none of which matches this repo. | Fixed | Updated the Home Manager, Nix concepts, nix-darwin options, and troubleshooting docs. |
| The KB docs checker cannot run in this checkout because `tools/kb/node_modules/effect` is absent. | Flagged for KB/tooling owner | Confirmed by the original hook failure: `Cannot find module 'effect/FileSystem'`. This worker did not change KB dependency management or internals. |
| Optional tool warnings remain for `shellcheck`, `actionlint`, and `nvfetcher`. | Flagged (existing environment state) | `intent/gate.sh session codex` reports them as `SOFT_MISSING`; hard admission tools are present. |

## Hook latency

Method: `/usr/bin/time -p` on the real `intent/gate.sh record` path using a
temporary `GIT_INDEX_FILE` containing the same formatting-valid staged change
to `modules/options/pkgs.nix`. The working tree and real index were untouched.

| Path | Before | After | Change |
|---|---:|---:|---:|
| Staged Nix admission | 10.82s | 9.34s | -1.48s (-13.7%) |

Both runs executed all four Nix gates and completed successfully. GitHub API
availability varied between runs, so the result is a single-run directional
measurement, not a benchmark claim. The unrelated-change pre-commit path also
now completes with a clear dependency warning instead of failing in the KB
docs import; its latency remains dominated by the existing GitHub source probe.

## Verification

- `bash -n` for every `intent/` and `scripts/` shell surface touched/audited
- `scripts/check-kb-assets-backup.sh --self-test`
- `intent/gate.sh session codex` and `intent/gate.sh audit`
- `git diff --check`
- Isolated staged-index admission run after the concurrency change (exit 0)
- Isolated malformed staged-Nix admission run (rejected as expected)

## Self-grade

**B+** — delivered a measured admission speedup, clearer recovery messages,
and four evidence-backed doc corrections without touching system semantics.
The KB docs gate could not be exercised end-to-end in this checkout because
its dependencies are absent; that dependency-management issue is explicitly
flagged rather than papered over.

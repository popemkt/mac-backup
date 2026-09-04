# Brief x-dx — Repo-wide developer-experience polish

Harness: codex. Zone: everything EXCEPT `tools/kb/ui/**` and
`tools/kb/src/foundation|operations|surface` internals (other waves own those;
read them freely). You own: repo-root scripts (`scripts/`, `intent/`),
`.githooks/`, `AGENTS.md` accuracy, `docs/*.md` accuracy vs current reality,
flake/devShell ergonomics, error-message quality of repo tooling.
Protocol rules that apply to you: gate first, verify before commit, never
push/merge, conventional commits on your branch.

## Mission (owner directive)

"Find stuff and polish the repo, both dx wise and functionalities wise."
Ground-up audit of the developer experience of living in this repo:

1. Hook latency: `.githooks/pre-commit` runs heavy checks serially. Measure
   it. Parallelize independent checks or add cheap fast-paths (e.g. skip
   flake eval when no .nix staged) WITHOUT weakening guarantees. Any speedup
   must keep every gate semantically intact.
2. Docs drift: walk AGENTS.md + docs/ claims against reality (commands exist?
   paths correct? examples runnable?). Fix what's stale; flag deeper rewrites.
3. Script ergonomics: confusing failures, missing --help, silent success
   without evidence, non-obvious flags in scripts/ and intent/. Improve
   messages; keep behavior compatible.
4. Dev-loop conveniences: anything you personally hit while working here that
   cost you time is a finding. Fix the cheap ones.
5. Do NOT touch module/nix semantics beyond formatting-level fixes; system
   behavior changes are out of scope tonight.

## Deliverable

Commits on your branch + handoff appended at
`docs/kb/waves/2026-08-23/reports/x-dx.handoff.md`: findings table (fixed vs
flagged), measured before/after hook latency, honest self-grade.

# CI

Two workflows gate this repo, plus two that maintain it.

| Workflow | Trigger | What it answers |
|---|---|---|
| `validate.yml` | PR, push to `main` | Is the repo green? |
| `kb-mutation.yml` | Weekly (Mon 04:00 UTC), manual | Which mutants does the test suite fail to kill? |
| `update-github-sources.yml` | schedule / manual | Are the GitHub release pins current? |
| `tailscale-policy.yml` | policy changes | Is the Tailscale ACL valid? |

`validate.yml` is the single answer to "does this change land". It has two
independent jobs that run in parallel because they share nothing:

- **`nix`** — `shellcheck`, `actionlint`, `nixfmt --check`, `statix`, `deadnix`,
  `nix flake check` (eval, then build), and release-pin verification. Runs
  inside `nix develop`, so the tool versions are the repo's own.
- **`kb`** — `bun run verify`, `bun run test`, `bun run test:ui`, and
  `bun run test:dst`, followed by the generated-docs check and the `.kb/assets`
  backup-ownership check.

## Pre-commit: the same questions, one commit earlier

`.githooks/pre-commit` is admission for this clone (registered in
`intent/SURFACES.md`; installed with `git config core.hooksPath .githooks`).
It runs the checks CI runs, and it runs them against a **reconstructed index
snapshot** — a detached linked worktree of `git write-tree` — never against
the working tree. That is the point of it: an unstaged fix must not be able to
mask a staged defect. Stage a defect, fix it in the working copy only, and the
hook fails on the staged content, which is what will be committed.

Two mechanics worth knowing, both learned the hard way:

- **A `git checkout-index` directory is not enough.** The kb harness reads the
  tree through `git ls-files` and `git check-ignore`, so a snapshot that is not
  a git repository fails eight of its own checks for the wrong reason. (`git
  stash --keep-index` is not a candidate at all — it moves the user's tree,
  which is the one thing a hook must not do.)
- **git exports `GIT_DIR` and `GIT_INDEX_FILE` into a hook**, and they name the
  committing repository. `git worktree add` that inherits `GIT_INDEX_FILE`
  checks the files out but leaves the new worktree's index *empty*, and then
  every tree-reading check passes on no files at all — a green hook that
  checked nothing. The hook scrubs those variables for every snapshot-directed
  git command and then asserts the snapshot's index equals its HEAD.

The snapshot borrows the checkout's `node_modules` rather than installing: the
content-addressed store and the caches by absolute symlink, every other entry
copied as the symlink it already is. That last part matters — a package's
`node_modules/@kb/<member>` link is relative to a sibling source directory, so
copied it resolves inside the snapshot, and shared it would resolve back into
the working tree.

### What triggers what

Each check runs when the staged paths include one of its own inputs. Unstaged
edits are invisible in the snapshot, so a check whose every input is unchanged
there has a known answer already:

| Check | Runs when the commit stages |
|---|---|
| kb generated docs (`docs-check.ts`) | `.kb/**`, `docs/kb/**`, `tools/kb/**` |
| `.kb/assets` backup ownership | `.kb/**`, `.gitignore`, `docs/backup-strategy.md`, `modules/darwin/home-manager/mackup.nix`, `scripts/check-kb-assets-backup.sh` |
| `bun run verify` (kb workspace) | `.kb/**`, `tools/kb/**`, `docs/kb/**`, `CLAUDE.md`, any `AGENTS.md`, `.githooks/**`, `.github/workflows/*.yml` |
| Nix lane — `nixfmt`, `statix`, `deadnix`, `nix flake check`, release pins | any `*.nix`, plus `nvfetcher.toml`, `_sources/**`, `pkgs/**` for the pins |

`verify`'s row reaches past the kb workspace because `verify` ends in
`bun run check:audit`, and `ext.check.audit` reads every `#rule`'s `home` file
(`CLAUDE.md`, `tools/kb/AGENTS.md`, `tools/kb/DESIGN.md`) and every `#check`'s
`evidence` file, plus the surface files in `@kb/ext-check`'s `SURFACE_FILES` —
this hook and the workflows. Staging a governance or policy file changes that
check's answer, so it runs.

The Nix lane keeps its own separate snapshot, built by `intent/gate.sh record`
with `git checkout-index`. That is deliberate rather than a leftover: those
checks feed `nix flake check "path:…"`, which copies the whole directory into
the store, so that snapshot has to stay a pristine ~9 MB checkout with no
`node_modules` in it. One index, two shapes, each built where its requirement
is stated.

### Cost

Wall time on this machine, hook run under the environment a real commit gives
it, new against the previous working-tree hook:

| Commit shape | Before | After |
|---|---|---|
| kb source (`tools/kb/**`) | 35.7 / 37.7 s | 38.4 / 39.4 s |
| Nix only | 16.6 s | 16.4 s |
| A doc outside the governed set | 16.3 s | 12.6 s |
| A doc inside it (`docs/kb/**`) | 14.6 s | 39.7 s |

The snapshot costs about 3 s (0.4 s for the worktree, 2.7 s to mirror
`node_modules`), and the narrower triggers give most of it back. The last row
is not a regression: `verify` did not run on a governed-doc commit before, and
that was the coverage gap.

## Why the kb job looks the way it does

- **It calls `bun run verify`, not its constituent tools.** `verify` is the one
  name for the complete KB toolchain gate: workspace typechecks, type-aware
  lint, dead-code analysis, and the repository harness.
- **`macos-15`, not `ubuntu-latest`.** The kb suite has only ever run on Darwin.
  Linux would be faster and cheaper, but a first-ever Linux run would mix real
  regressions with portability noise. Moving it is a worthwhile follow-up on its
  own, not a side effect of adding CI. (`modules/nixos/` is the eventual reason
  to care.)
- **The DST sweep runs 25 extra seeds.** `bun test` already runs the committed
  seeds; the sweep is the only thing that exercises replay determinism on seeds
  nobody has looked at. It is pure and in-memory, so it is nearly free.

## What CI deliberately does NOT run

- **Mutation testing** — see the header comment in `kb-mutation.yml`. It is slow
  and its score is not reproducible (unseeded fast-check: three runs over
  byte-identical source gave 9, 53, then 68 survivors). A per-PR pass/fail on
  that number would be noise. Weekly, with the survivor report as an artifact.
- **The Playwright render harness** (`ui/tests-render/`). Three specs in
  `graph.e2e.ts` fail at HEAD and have since wave i11 — force2d and force3d
  report zero nodes, cluster never switches. Wiring a permanently-red or
  permanently-yellow job teaches people to ignore CI. **Fix those three specs,
  then add the job**; it needs `bunx npm@12 run test:render` because of the
  `devEngines` pin, plus a Playwright browser install step.

## Still manual

**Branch protection is not enabled.** CI runs on every push to `main`, but
nothing stops a push that fails it. Making the check required means:

```bash
gh api -X PUT repos/popemkt/mac-backup/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["nix", "kb"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

That is a behavioural change for a solo repo — it makes direct pushes to `main`
that fail CI impossible, which is the point, but it also means a red run blocks
you until it is fixed or admin-overridden. Enable it deliberately.

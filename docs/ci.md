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
- **`kb`** — `npm run verify` (typecheck + `vp check` + `lint:all` + `knip`),
  the `ui` typecheck, the core suite (`bun test`), the UI suite (`vp test`), a
  25-seed deterministic-simulation sweep, the generated-docs check, and the
  `.kb/assets` backup-ownership check.

## Why the kb job looks the way it does

- **It calls `npm run verify`, not its four parts.** `verify` exists precisely
  so there is one name for "the kb toolchain is clean". Inlining its steps would
  create a second definition that drifts.
- **`ui` typecheck is separate.** `verify` typechecks the root package only; the
  `ui` package has its own `tsconfig.json`, and `.githooks/pre-commit` gates
  both. It is invoked as `./node_modules/.bin/tsc` rather than through npm
  because `ui/package.json` declares `devEngines` npm 12, and `npm run` there
  fails `EBADDEVENGINES` on the runner's npm.
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

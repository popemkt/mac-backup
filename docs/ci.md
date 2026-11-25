# CI

One workflow gates this repo, one moves the `deploy` branch shared-server
applies, and the rest maintain it.

| Workflow | Trigger | What it answers |
|---|---|---|
| `validate.yml` | PR, push to `main` | Is the repo green? |
| `deploy.yml` | a gating workflow finishing on `main`, hourly, manual | Which `main` commit may shared-server run? |
| `update-github-sources.yml` | schedule / manual | Are the GitHub release pins current? |
| `tailscale-policy.yml` | PRs changing the policy | Is the Tailscale ACL valid? |
| `tailscale-reconcile.yml` | push to `main` that can change Tailscale state, manual | Does the tailnet match the current `main` (Services, then policy)? |

`validate.yml` is the single answer to "does this change land". It has two
independent jobs that run in parallel because they share nothing:

- **`nix`** — `shellcheck`, `actionlint`, `nixfmt --check`, `statix`, `deadnix`,
  `nix flake check` (eval, then build), release-source consistency
  and provenance ([release-pin checks](github-release-packages.md#commands)),
  and the Tailscale policy check
  (`scripts/check-tailscale-policy.sh check`: every Service a host declares
  has a grant naming it and a Service auto-approver for one of its host's
  `my.stacks.vpn.tags`). Runs inside `nix develop`, so the tool versions
  are the repo's own. It does not ask whether the pins are current; what each
  command proves, and why freshness gates nothing, lives in
  [github-release-packages.md](github-release-packages.md#commands).
- **`kb-data`** — `kb docs check` (the generated docs match `.kb` data),
  `kb check audit` (every rule and check is wired to the home, evidence and
  enforcement it names), `kb check gaps` (every GAP marker in a tracked file
  names an open `#gap` node), and the `.kb/assets` backup-ownership check. The `kb` is the release the flake
  pins (`pkgs/kb`, in the dev shell), the same one every host installs and the
  pre-commit gate calls. kb's own code is built and tested in
  [popemkt/kb](https://github.com/popemkt/kb)'s CI, not here.

## Deploy gate

`deploy.yml` runs `scripts/deploy-gate`, which fast-forwards `deploy` to the
newest `main` commit that Validate passed and whose Tailscale reconcile
has settled successfully; shared-server applies `deploy` by
itself. It gates nothing on a PR and never forces the branch. The rules, the
agent on the host, and how to pause it:
[deploys.md](deploys.md).

## Pre-commit: the same questions, one commit earlier

`.githooks/pre-commit` is admission for this clone (registered in
`intent/SURFACES.md`; installed with `git config core.hooksPath .githooks`).
It is a shim: everything it checks is `intent/gate.sh record`, which runs the
checks CI runs against a **reconstructed index snapshot** (`git
checkout-index` into a temporary directory), never against the working tree.
That is the point of it: an unstaged fix must not be able to mask a staged
defect. Stage a defect, fix it in the working copy only, and the hook fails on
the staged content, which is what will be committed. The same snapshot feeds
`nix flake check "path:…"`, which copies the whole directory into the store.

### What triggers what

Each check runs when the staged paths include one of its own inputs. Unstaged
edits are invisible in the snapshot, so a check whose every input is unchanged
there has a known answer already:

| Check | Runs when the commit stages |
|---|---|
| kb generated docs (`kb docs check`) | `.kb/**`, `docs/kb/**` |
| `kb check audit`, `kb check gaps` | every commit: their inputs are every file the store names and every GAP marker, which only kb can list |
| `.kb/assets` backup ownership | `.kb/**`, `.gitignore`, `docs/backup-strategy.md`, `modules/darwin/home-manager/mackup*.nix`, `scripts/check-kb-assets-backup.sh` |
| Tailscale policy covers every declared Service | any `*.nix`, `flake.lock`, `configs/tailscale/policy.hujson`, `scripts/check-tailscale-policy.sh` |
| Nix lane — `nixfmt`, `statix`, `deadnix`, `nix flake check`, release-source consistency | any `*.nix`, plus `nvfetcher.toml`, `_sources/**`, `pkgs/**` for the sources |

## What CI deliberately does NOT run

- **Building the NixOS host.** `nix flake check` on the macOS runner evaluates
  `nixosConfigurations.shared-server`, so option errors and broken module
  wiring go red, but an x86_64-linux system cannot be built there. The build
  is proven on the host itself before every switch: by `rebuild`, or by the
  pull agent, which leaves a failed unit and the host unchanged when a
  `deploy` commit does not build ([deploys.md](deploys.md#failures)).

## Still manual

**Branch protection is not enabled.** CI runs on every push to `main`, but
nothing stops a push that fails it. Making the check required means:

```bash
gh api -X PUT repos/popemkt/mac-backup/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["nix", "kb-data"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

The required contexts are the job names, `nix` and `kb-data`. Until kb moved
to its own repo the second job was `kb`; a protection rule written from an
older copy of this command would wait forever on a job that no longer runs.

The `deploy` branch wants its own protection (no force pushes, no
deletion, nothing that blocks the gate's token):
[deploys.md → Turning it on](deploys.md#turning-it-on-once).

That is a behavioural change for a solo repo — it makes direct pushes to `main`
that fail CI impossible, which is the point, but it also means a red run blocks
you until it is fixed or admin-overridden. Enable it deliberately.

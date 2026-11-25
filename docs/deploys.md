# Deploys: shared-server applies green `main` by itself

shared-server no longer waits for someone to run `rebuild` after a merge.
CI moves a `deploy` branch forward to each `main` commit it has fully
passed, and a pull agent on the host applies `deploy`. The Macs are
unchanged: they apply with `rebuild` by hand.

```
push to main ──► Validate, Tailscale reconcile (CI)
                    │ each completion
                    ▼
            Deploy gate (deploy.yml → scripts/deploy-gate)
                    │ fast-forwards `deploy` to the newest green commit
                    ▼
shared-server: pull-deploy-poll.timer (every 2 min)
                    │ new commit on deploy, ahead of what the host runs
                    ▼
            pull-deploy.service: build → switch → post-switch steps
```

## The gate

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs
[`scripts/deploy-gate`](../scripts/deploy-gate) every time Validate or
Tailscale reconcile finishes on `main`, hourly as a
safety net, and by hand (`gh workflow run deploy.yml`). It looks at `main`'s
first-parent commits after `deploy` and pushes `deploy` to the newest one
that is green:

- **Validate** (`validate.yml`) succeeded on that commit itself. A commit
  pushed together with others, or whose run was cancelled by a newer push,
  has no passing run of its own and is never a target.
- **Tailscale reconcile** (`tailscale-reconcile.yml`) is the one workflow
  that writes Tailscale state. It runs on pushes that touch its paths, and
  every run reconciles **the current `main`**, not the commit that triggered
  it: it creates or updates every declared Service, then applies the whole
  policy, every time (the Service auto-approvers resolve against existing
  Services, so the policy follows the sync). A run that starts late, waits
  in its queue (`tailscale-reconcile`, one at a time, never cut off), or is
  rerun can therefore only write the newest state; the order of runs stops
  mattering, and a run whose policy apply failed is red, so its rerun
  applies the policy again. The gate needs it for a candidate whose
  reconcile paths changed since `deploy`. Let L be the last commit up to
  the candidate that touched them (found in the whole history, not just
  the commits looked at). There must be positive evidence: at least one run
  on a commit from L to the candidate, all of them ended, the newest
  successful, and that newest run applied the candidate's Tailscale state.
  A run applies main as it was at its checkout, not its triggering
  commit, so the run names that commit in its last job (`applied <sha>`),
  and the gate accepts it only if its watched paths are identical to the
  candidate's (`git diff --quiet`); otherwise it holds for a run that
  matches. A run GitHub has not listed yet is
  no evidence, so it holds `deploy`; a failed run holds `deploy` until a
  later run succeeds (`gh workflow run tailscale-reconcile.yml`, or a rerun),
  even for commits that do not touch Tailscale state. No run since `deploy`
  may still be going. More than 100 commits between L and the candidate
  holds rather than guesses. The gate's copy of the workflow's path filters
  is checked against the workflow file.
- Any failed or malformed read of the Actions API ends the gate run without
  a decision (the job fails); only good answers are cached, so a missing
  answer is never read as "no runs".

That ordering is why the host's post-switch restart of
`tailscale-services.service` now works the first time: a host advertising a
new Service is approved only once CI has created it and reapplied the
policy, and the agent applies only after both.

The push is plain (`git push origin <sha>:refs/heads/deploy`) with the
run's own `GITHUB_TOKEN` (`contents: write`, `actions: read`; no new
secret). GitHub refuses a push that is not a fast-forward, so `deploy` never
moves backwards; when a concurrent run moved it further meanwhile, the gate
sees that and stops. Runs are serialized (`concurrency: deploy-gate`); one
waiting there may be replaced by a newer one, which is harmless since each
run walks every commit after `deploy`. If `deploy` holds a commit `main`
lacks, the gate fails and changes nothing (fix `deploy` by hand).

## The agent

`my.stacks.pull-deploy` ([modules/stacks/pull-deploy](../modules/stacks/pull-deploy)),
on for shared-server only. Two units:

- **`pull-deploy-poll`** (timer, 2 min after the last poll): fetches
  `deploy` and `main` from the public GitHub repository anonymously, and
  starts the apply when `deploy` holds a commit the host neither runs nor
  has failed on. It always succeeds.
- **`pull-deploy`** (oneshot, root): builds
  `nixosConfigurations.shared-server` from a clean checkout of the commit,
  checks that the built system records that commit, then takes the apply
  lock, decides again, sets the system profile, runs
  `switch-to-configuration switch` (what `nixos-rebuild switch` runs) and
  the post-switch steps. A switch never restarts or stops either unit.

### Never backwards (rebuild and agent agree)

Every NixOS system records the commit it was built from in
`/run/current-system/configuration-revision` (`flake.nix` sets
`my.revision`; `modules/nixos/system/applying.nix` writes it). Not
`system.configurationRevision`: that also lands in `nixos-version`, so every
commit would change `system-path` and restart polkit and accounts-daemon. One rule, in [`scripts/lib/deploy-guard.sh`](../scripts/lib/deploy-guard.sh),
decides for both the agent and `rebuild` on a shared host:

| Target vs what the host runs | Agent | `rebuild` |
|---|---|---|
| same commit | nothing to do | reapplies |
| descends from it | applies | applies |
| ancestor of it (someone applied a newer `main`) | skips, logs `Never rolling back` | refuses: pull first |
| unrelated or dirty (an emergency apply) | holds: failed unit | refuses, unless `REBUILD_LOCAL=1` |
| not recorded (a system from before revisions were recorded) | holds: failed unit | applies, with a note |

Both hold `/run/dotfiles-apply.lock` from that decision to the end of the
post-switch steps, so the one that waits decides against what the other
applied. `rebuild` takes the lock *before* it fetches `origin/main`, so a
commit the agent applied while it waited is in what it compares against
(and it then refuses as "behind origin/main": pull and rerun). So `rebuild`
from a current `origin/main` (possibly ahead of `deploy`) always works, and
the agent then skips the older `deploy` commits until `deploy` passes what
was applied.

`pause` takes the same lock and the agent checks for a pause again under
it, right before switching: a pause during a build stops that build from
switching, and a pause during a switch waits for it to finish.

### Post-switch steps

[`scripts/lib/post-switch.sh`](../scripts/lib/post-switch.sh) is the one
home of what follows every switch, run by both `rebuild` and the agent:
`bb-plugins-sync` (rebuild: the person running it; the agent: every person
on the host, as them), a restart of `tailscale-services.service`, and
`restart-app --status`. Restarts of apps with an `idleCheck` (bb's host
daemon) stay deferred: that lives in the switch's activation
(`modules/nixos/system/services.nix`), which the agent runs like any switch,
and nothing here restarts an app itself. The agent runs in its own unit, not
in an app's cgroup, so no app restart can cut it off.

### Failures

A build that fails, a switch that exits non-zero, or a hold leaves
`pull-deploy.service` **failed**, with a journal line starting
`pull-deploy: FAILED:` saying why and what the host still runs. A failed
build changes nothing: the host stays on its generation. The unit stays
failed, without retrying, until `deploy` moves, the host catches up some
other way (a `rebuild`), or `sudo pull-deploy now`. A monitor that alerts on
failed units therefore alerts once per bad commit.

A fetch that fails (GitHub down) is logged and retried at the next poll, not
a failed unit; `pull-deploy status` shows when the last fetch succeeded.
<!-- GAP [[01M89TBG2GTS2ACABN4C68FZKB]]: a fetch failing for long fails no unit. -->

## Operating it

```bash
pull-deploy status                 # applied commit, deploy and main, mode, last failure
sudo pull-deploy pause "<reason>"  # stop applying; survives reboots and switches
sudo pull-deploy resume            # apply again (polls at once)
sudo pull-deploy now               # forget a failure and poll at once
journalctl -u pull-deploy -u pull-deploy-poll
git ls-remote origin deploy main   # where the branches are on GitHub
```

- **Force a manual apply:** `rebuild` from a clean checkout at
  `origin/main`, as before. It waits for an apply in flight, then switches
  (forward only). Nothing to pause.
- **Emergency apply of unpushed work:** `sudo pull-deploy pause "…"`, then
  `REBUILD_LOCAL=1 rebuild`. Without the pause the agent holds anyway (a
  failed unit), since the host then runs a commit `deploy` lacks, and a
  plain `rebuild` refuses too. To leave it: push the fix and let it reach
  `deploy`, or apply `origin/main` with `REBUILD_LOCAL=1 rebuild` from a
  clean checkout of it; then `sudo pull-deploy resume`.
- **Stop a bad commit from rolling out:** pause, then revert on `main`.

## Turning it on (once)

1. Merge. The first gate run after Validate passes creates `deploy`.
2. On shared-server, run `rebuild` once (detached, as CLAUDE.md says): it
   installs the agent and the first system that records its revision. Until
   then the host's revision is unknown, and the agent would hold.
3. The owner's manual step, branch protection (GitHub → Settings →
   Branches, or the API below; this repo changes no settings itself):
   - `main`: require the checks `nix` and `kb-data`, as
     [ci.md](ci.md#still-manual) describes, so only green commits reach
     `main` at all.
   - `deploy` (after step 1 created it): no force pushes, no deletion, no
     required checks or reviews, and no push restrictions, so the gate's
     `github-actions` token can still fast-forward it:

     ```bash
     gh api -X PUT repos/popemkt/mac-backup/branches/deploy/protection \
       --input - <<'JSON'
     {
       "required_status_checks": null,
       "enforce_admins": true,
       "required_pull_request_reviews": null,
       "restrictions": null,
       "allow_force_pushes": false,
       "allow_deletions": false
     }
     JSON
     ```

     `enforce_admins: true` keeps the owner from force-pushing it by
     accident; lift it only to repair a `deploy` that `main` does not
     contain.
   - Settings → Actions → General → Workflow permissions may stay "Read
     repository contents": the workflow asks for `contents: write` itself.

## Why not comin or `services.self-deploy`

Both were candidates. Neither can keep the no-rollback rule above:

- **comin** checks only that a new commit fast-forwards the one *it* last
  deployed. It does not know about a `rebuild` that applied a newer `main`,
  so it would switch the host back to the older `deploy` commit. It has no
  hook before a switch to add that check, a failed deployment does not fail
  its systemd unit (it is one long-running daemon), and it would add a flake
  input with its own Go build to trust.
- **`services.self-deploy`** (nixpkgs) builds with `nix-build` from a file,
  not a flake, and has no hook before or after the switch.

The agent is the shape of `services.self-deploy` (a oneshot plus timer,
`restartIfChanged = false`), flake-aware, with the guard, the shared
post-switch steps and a failed unit per bad commit.

## Tests

- `checks.x86_64-linux.pull-deploy`
  ([tests.nix](../modules/stacks/pull-deploy/tests.nix)): a NixOS VM with
  the real units and a local bare repository standing in for GitHub. Each
  commit is a small flake whose system builds in a second and whose switch
  records itself. It checks: a host running an unknown revision is held
  (failed unit, no retry); a manual apply that catches up clears it; a new
  commit is applied and the post-switch steps run (Services restart,
  bb-plugins-sync as the person, `restart-app --status`); an older `deploy`
  is never applied, even when the apply is started by hand; a commit that
  does not build leaves the host and its profile where they were and the
  unit failed, without retrying; pause and resume; a pause during a build
  stopping that build's switch, and a pause waiting for a switch in flight;
  `status` for a person; and `rebuild` on the shared host refusing to roll
  back what the agent applied, including a commit the agent applied while
  `rebuild` waited for the lock, and refusing an unrecognized recorded
  revision unless `REBUILD_LOCAL=1`.
- `checks.*.deploy-gate-check`
  ([deploy-gate-check.sh](../scripts/tests/deploy-gate-check.sh)): the gate
  against a temporary bare repository and a `gh` that answers the runs API
  from fixtures: creating `deploy`, skipping commits still validating or
  never validated, a failed or running Tailscale run holding later commits,
  a required run not listed yet, a failed run older than the commits looked
  at, a failed runs or jobs API read ending the gate rather than counting
  as no runs, a run credited to the commit it checked out rather than its
  trigger, the path filters matching the workflows, the reconcile checking out
  the current `main` and ending every run with a policy apply (and the PR
  workflow applying nothing), pull-request runs not counting, never
  moving backwards, a concurrent move winning, and refusing a `deploy` off
  `main`.

Each check fails with its fix removed (verified by hand for the guard, the
no-retry rule, the post-switch call, the build failure, rebuild's guard, a
forced push, and each of the gate's rules).

## Limits

- CI does not build the Linux host (see [ci.md](ci.md#what-ci-deliberately-does-not-run)),
  so a green commit can still fail to build there; that is the failed unit
  above, and the host stays where it was.
- A commit whose `flake.lock` is out of date builds without a revision, so
  the agent refuses it (`records revision ''`).
- Every commit is a new system generation, and `nix-generation-prune`
  keeps seven.

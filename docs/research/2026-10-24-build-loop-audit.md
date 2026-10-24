# Build-loop audit: where wall-clock goes when agents build bb plugins and NixOS changes

Date: 2026-10-24. Scripts and raw output: `/tmp/build-audit/` (an.py, an2.py, seg.py, hooktime.sh, npmtime.sh, rollup.txt, combined.txt).
Legend: **[M]** = measured, **[E]** = estimated or inferred. Read-only on shared-server; throwaway worktree removed.

## Headline

1. **Model think time is the bottleneck: 51-77% of builder wall time** (about 6-10 s of model time per tool call). The repo's checks are NOT the bottleneck.
2. **The biggest recoverable tool cost is `nix develop` used as a per-call wrapper** (to get the pinned kb). It cost about 1090 s across 4 builders, about 1030 s of it avoidable. That is up to 23% of the restart-resume builder and 17% of the bb-split builder.
3. The pre-commit hook is cheap (1-3 s for plugin-only changes, 6-12 s warm for `.nix` changes). The gate itself is about 0.2-1.5 s when kb is not stale.
4. The Mac's `kb` is always stale (the pin moves 3-4 times a day, the Mac only updates on `rebuild`). This forces every agent into `nix develop` wrappers and PATH hacks, and causes failed commits.
5. The remote loop is fast: a rebuild on shared-server takes 15-37 s end to end. The one big loss there was a polling bug (below).

## 1. Builder transcripts

Parsed from `~/.claude/projects/-Users-popemkt--dotfiles/71894daf-.../subagents/agent-*.jsonl`. Tool time is tool_use to tool_result. "Model/think" is everything that is not tool time (generation, thinking, harness). Idle gaps over 900 s between rounds are excluded. Several tool calls can overlap, so the shares are approximate.

Note: the task's quoted durations (1221, 1447+1794, 2036+976 s) do not map one-to-one onto transcript segments.
- restart-resume is a single 1798 s segment.
- bb split is segments of 2035 s and 976 s (matches).
- bbim has 7 segments: 6813, 902, 460, 2702 and 2642 s are the large ones; 1221 s does not appear.

Active (non-idle) wall time and where it went, per builder:

| Builder (work) | Active wall | Model/think | nix develop-wrapped calls | Repo checks run directly | ad-hoc nix eval/build | npm install/verify/test + bb | ssh | Read/Edit | other bash/git |
|---|---|---|---|---|---|---|---|---|---|
| a6d21bbd (bbim, 7 rounds) | 13558 s | 76.9% | 0.9% (128 s) | 0.6% | 4.7% (643 s, one `nix build .#kb` = 603 s) | 7.1% | 0 | 3.1% | 6.8% |
| a0961ff4 (restart-resume) | 1798 s | 51.1% | **22.9% (412 s)** | 3.2% | 0 | 7.8% | 4.8% | 3.0% | 7.1% |
| acce6c23 (bb split) | 3011 s | 60.0% | **17.3% (521 s)** | 3.2% | 12.2% (368 s) | 0 | 1.4% | 2.2% | 3.7% |
| aa393de0 (idle restart) | 696 s | 65.1% | 5.4% (37 s) | 4.2% | 1.3% | 0 | 0 | 1.0% | 22.9% (160 s, a check script) |
| ab310136 (Sol review bbim) | 469 s | 94% | none | none | none | 6% | none | none | none |
| aa31adf2 (Sol review split) | 1224 s | 69% | none | none | 24% (nix eval experiments) | none | 3.3% | none | 3.7% |

Aggregate over all six, 20757 s active: ad-hoc nix eval/build 6.3%, npm/bb plugin 4.8%, nix develop wrapped about 5.5% (all kinds), direct repo checks about 3%, ssh 0.8%. The rest is model time.

Per-category totals for all six (n, sum, p50, max in seconds):

| Category | n | sum | p50 | max |
|---|---|---|---|---|
| nix eval/build (ad-hoc experiments) | 40 | 1313 | 11.4 | 603 |
| npm install/verify/test (+bb plugin new) | 178 | 1122 | 3.1 | 121 |
| nix develop > kb (docs materialize, add, set, help) | 14 | 416 | **22.9** | 88.6 |
| nix develop > gate.sh session | 6 | 205 | 19.3 | 117.6 |
| nix develop > flake check | 4 | 169 | 42.0 | 67.1 |
| nix develop > lint | 6 | 149 | 23.7 | 64.7 |
| nix develop > other (PATH probes) | 17 | 154 | 5.9 | 55 |
| git commit (hook) | 35 | 215 | 2.0 | 78.9 (hook with .nix change plus flake check under load) |
| ssh shared-server | 60 | 168 | 1.6 | 29.2 |
| sleep/poll | 3 | 126 | 23 | 103 |
| Read/Edit/Grep | 535 | 548 | 0.4 | 15.7 |

`nix develop` per call, all builders (calls over 1 s): 40 calls, 1092 s total, median about 20 s on the three heavy builders (p50 20.7 s for a0961 and 20.9 s for acce), up to 88 s. Estimated saving with a cached dev environment is about 1030 s [E, inner command cost taken from direct timings].

Retries and waste [M, counted from tool results]:
- 109 failed tool calls out of about 1500 (about 7%): a6d 59, a0961 14, acce 27, aa39 9.
- 10 `STALE_TOOL` failures (kb on PATH is not the pinned release). They fail the gate, which fails the commit hook. Every builder's first `intent/gate.sh session` failed this way.
- **81 harness-guard blocks** ("This agent is isolated in the worktree ... runs nix with a git command ..."): a6d 40, a0961 13, acce 19, aa39 9. This is a direct consequence of wrapping git or commit in `nix develop`. Each block costs a wasted model turn of about 6-10 s [E], so about 8-13 min across the builders.
- Commits: a6d made 27 commit attempts (about 17 hook passes, rest blocked or failing on STALE_TOOL), a0961 7, acce 4, aa39 3. Hook runs that actually ran the checks took 1.5-3 s each, except those with `.nix` changes: 14 s (aa39), 21.6 s and 27.5 s (a0961), 11 s and 79 s (acce, under heavy load).

Model time per tool call is about 9.6 s (bbim), 5.8 s (restart-resume), 8.8 s (bb split). Reviewers (Sol) are 70-94% model time. Few tool calls but long thinking.

Main-session loss (not a builder), 2026-10-23 18:19: the rebuild poll loop used `pgrep -f "dotfiles/scripts/rebuild"` over ssh. That pattern matches the tailscale ssh wrapper process's own command line, so it never reported DONE. The rebuild itself finished 18:20:10; the poll ran for 600 s (timeout), then another 448 s before the user cancelled it. **About 575 s lost on the first, plus about 420 s on the second [M]**. Later rebuilds polled the log for "Done." and were fine.

## 2. Direct timings (throwaway worktree of origin/main, ac641830)

The machine was heavily loaded during the first half of the measurements (load average 21-43 with 10 cores; Orca renderer, ESET scand, mds, other agents). Where results varied I give min / typical-under-load. Do not read the cold numbers as best case.

| Phase | Result | Notes |
|---|---|---|
| `intent/gate.sh session` direct (Mac PATH kb) | 0.2-1.5 s, **exit 1: STALE_TOOL** (Mac kb 20261023115701, pin 20261023183556) | [M] |
| `nix develop -c true`, clean tree, warm | 0.8-1.1 s (quiet), 2.9-17 s (loaded) | [M] eval cache hit |
| `nix develop -c true`, **dirty tree** (the builder case) | **3.5-4.4 s (quiet)**, 10-20 s (loaded) | [M] no eval cache for a dirty tree, re-evaluated every call |
| `nix develop -c true`, first time in a new path/rev | 20 s and 94.6 s (loaded), 7 s (quiet) | [M] devShell evaluation instantiates thousands of drvs (nvfetcher, shellcheck, statix pull in Haskell/Rust sets; 7355 `-vv` lines) |
| `nix develop -c intent/gate.sh session` | 1.4-2.2 s quiet, 12-17 s loaded | [M] |
| `nix develop -c kb --version` / `kb docs check` | 13.4 s / 10.8 s loaded; direct kb is 0.3 s / 0.2-0.7 s | [M] about 10 s of pure wrapper overhead on a loaded machine |
| `nix print-dev-env > env.sh`, then `source env.sh` | 5.9 s once, then **0.3 s per use** | [M] pinned kb on PATH, no `nix develop` per call |
| `kb docs check` / `materialize` / `check audit` / `check gaps` (with `--files-from -`) | 0.2 / 0.2-0.3 / 0.2 / 0.3-0.8 s | [M] warm; kb is not slow |
| `scripts/check-kb-assets-backup.sh check` | 1.0 s | [M] |
| `scripts/check-tailscale-policy.sh check` | 0.1 s (cached) to 14 s first run / 1.2-3.1 s | [M] runs a nix eval, on every `.nix` change |
| `nixfmt --check` one file / `statix check .` / `scripts/deadnix-repo` | 0.2 / 0.0-0.2 / 0.2-0.4 s | [M] tiny; not worth scoping |
| `nix flake check --no-build` (hook form, `path:<snapshot>`) | 9-15 s every time (eval cache does not apply), first-ever 108 s on a cold store | [M] this is the dominant cost of a `.nix` commit |
| `nix flake check --no-build --all-systems` | 19.6 s | [M] |
| Full hook, `.nix` change (comment in modules/stacks/bb/default.nix), 4 runs | 49 s (first, cold), 11.9, 6.1, 6.7 s | [M] stage breakdown below |
| Full hook, `.ts` change in restart-resume, 3 runs | **2.7, 1.2, 1.0 s** | [M] only kb audit + gaps + snapshot copy |
| `restart-resume`: `npm ci` (full) / `npm run verify` | 1.2 s (warm cache) / 2.6-3.2 s | [M] |
| `bbim`: `npm ci` (full) / `npm run verify` / typecheck / test / `bb plugin build` | 11.0 s / 13.9-14.1 s / 2.6 s / 7.4 s / 0.9 s | [M] `bb plugin build` is cheap |
| `npm ci --omit=optional` (what Home Manager uses) then `npm run verify` | **fails**: oxlint and effect-tsgo native binaries are optional deps | [M] dev loop needs a full install; HM install is fine because it only runs `bb plugin install` |

Hook stage breakdown for a `.nix` change, warm (6-12 s): tailscale policy check 1.2-3.1 s, parallel group (nixfmt, statix, deadnix, flake check; wall is flake check) 2.6-7.0 s, kb version check 0.2-0.5 s, kb audit 0.2 s, kb gaps 0.4 s, checkout-index 0.1-0.4 s. In the cold first run, `kb --version` alone took 23 s (first exec of a store binary under load, probably endpoint scanning), tailscale check 14 s, flake check about 6 s of waiting.

Answers to the specific questions:
- **Does the hook run whole-repo checks for a plugin-only change?** No. Everything under `record_admission` after the kb checks returns early when no `.nix` is staged (`[ -z "$nix_changes_staged" ] && return 0`). What always runs: `kb check audit` and `kb check gaps` over the whole snapshot, plus `git checkout-index --all` (about 1-2 s total). For a `.nix` change, statix and deadnix are whole-repo, but they take under 0.5 s; the whole-repo `nix flake check --no-build` is the real cost (9-15 s).
- **Does the gate repeat work the hook does?** Yes, slightly. `record` calls `check_env` again (the same 0.2-0.5 s as `session`). The agents also run `session` once, then the hook runs it per commit. Negligible. The real repetition is agents running lint and flake check by hand and then again in the hook (a0961: flake check 67 s by hand, then hook 21-27 s; acce: flake check by hand 45 s, 39 s all-systems, 17 s, then hook).
- **`bb plugin build` alone**: 0.5-1.1 s. **`npm ci`**: 1-11 s on a warm npm cache; 55-121 s cold in the builders (`npm install --include=dev`, a6d and a0961 first run).
- **Home Manager plugin install path** (`modules/common/home-manager/bb-plugins.nix`): not run locally (it would change the live bb install). From the shared-server journal [M]: about 1-1.5 s per plugin (`bb plugin install`), plus 1-2 s for each `npm ci --omit=optional` when a lockfile changed; 5 plugins took 5 s (11:18:10 -> 11:18:15 with one npm ci). A plugin is skipped if its stamp is unchanged.

## 3. kb lag: what it costs

- The pin (`_sources/generated.json` kb.version) moved 3-4 times in 24 h (10-23: 05:17, 11:14, 12:12, 18:51, 10-24: 00:29). The Mac's `kb` comes from the Home Manager profile and only advances on `rebuild`, so it is stale most of the day. On 10-24 it was 1 nightly behind (`...115701` vs `...183556`).
- The gate demands exact equality, so on the Mac **the gate is failing by default** and the hook refuses every commit that is not run under the dev shell PATH. Every builder hit this on its first call.
- Workarounds the builders used, with costs [M]:
  - `nix develop -c <cmd>`: median 20.9 s per call (builders, loaded), 3.5-4.4 s (dirty tree, quiet), 0.8-1.1 s (clean tree, quiet). 40 calls, 1092 s total.
  - A hand-built PATH (`nix print-dev-env` or `printenv PATH` into a file): a0961 did this once (10 s). This is cheap, but it was rediscovered ad hoc by each builder.
  - `nix build .#kb`: 17.6 s and 22 s; once **603 s** (a6d, outlier: probably network or store-lock contention; not explained by the transcript).
  - Failed attempts: 10 STALE_TOOL failures, 81 harness-guard blocks (git inside `nix develop`).
- Per call cost of the lag: about 10-20 s (loaded) or 3.5 s (quiet, dirty tree) vs 0.3 s with a sourced cached env. Total about 1 ksec over 4 builders, plus the wasted retry turns.

## 4. Remote loop (shared-server, 16 cores, read-only)

Sources: `~/rebuild-*.log` (no timestamps), journal (sudo / switch-to-configuration / hm-activate), and the main-session tool timestamps for rebuild starts. Start = the ssh `git pull` + `scripts/rebuild` launch. "Eval+build" = launch until `sudo ... switch-to-configuration`. "Switch" = `nixos-rebuild-switch-to-configuration.service` wall time (includes Home Manager activation).

| Rebuild (date, change) | Eval+build | Switch | HM plugin install | Total |
|---|---|---|---|---|
| 10-24 00:05 bbim (plugin-only) | about 13 s | 1.8 s | none (HM generation unchanged, no `hm-activate` lines) | about 15 s |
| 10-23 18:40 bbim settings fix | about 13 s | 1.8 s | none | about 15 s |
| 10-24 10:33 bbim2 | about 14 s | 2.5 s | none | about 17 s |
| 10-24 11:38 idle-host fix | about 12-20 s | 2.4 s | none | about 15-23 s |
| 10-23 18:20 bbim (first) | about 16 s | 9.4 s | about 5 s: agent-artifacts, bbim (+npm ci 2 s) | about 25 s |
| 10-24 11:17 restart-resume | about 16 s (10 drvs) | 9.4 s | 5 s (6 plugins, one npm ci 1 s) | about 25 s |
| 10-24 10:09 idle restart (7 drvs) | about 27 s | 4.1 s | skipped (no bb server answered) | about 32 s |
| 10-24 11:35 bb server/daemon split (50 drvs) | about 28 s | 8.2 s | 4 s (4 plugins) | about 37 s |

- Switch is 1.8-9.4 s; the HM install loop adds about 1-1.5 s per plugin.
- **Finding [E, inferred from journal]**: a plugin-only edit (bbim 00:05, 10:33, 18:40) produces no Home Manager activation, so `installBbPlugins` did not run in those rebuilds. HM activation only reruns when the HM generation changes (a Nix-side change), because the plugin lives in the checkout and is not part of any derivation. A plugin-only change therefore needs a second trigger to install it (the 00:12:34 switch did install bbim). The rebuild's 15 s buys nothing for a plugin source change.
- Polling loops: the log-grep polls were fine; the `pgrep -f` poll cost 575+ s (see section 1).
- ssh calls themselves: 60 in builders, p50 1.6 s, max 29 s (one `tar | ssh` copy of bb dist files); total 168 s (0.8%).

## Ranked bottlenecks (share of active builder wall time, 4 builders = 19063 s)

| Rank | Bottleneck | Share | Evidence |
|---|---|---|---|
| 1 | Model think / turn latency | 51-77% (about 65% overall) | [M] about 6-10 s per tool call; 94% for reviewers |
| 2 | `nix develop` wrapper for kb (stale Mac kb) incl. retries and guard blocks | about 6% of tool+model directly (1092 s); up to 23% on restart-resume; plus about 10 min of wasted turns [E] | [M] 40 calls, median 20 s; 81 guard blocks; 10 STALE_TOOL |
| 3 | Ad-hoc nix eval/build experiments (bb split: eval of shared-server config, 11-85 s each) | 4.7% (bbim, mostly one 603 s `nix build .#kb`) and 12.2% (split) | [M] legit but repeated cold evals; custom `run.sh` re-evaluates the whole host each time |
| 4 | npm install / verify / `bb plugin` loop (including a 121 s `npm install`, a 72 s `find /`) | 7% (bbim, restart-resume) | [M] verify itself is 3-14 s; the first install is the cost |
| 5 | `nix flake check --no-build` run by hand and again by hook (9-15 s warm, 40-67 s loaded) | about 2-4% for `.nix` builders | [M] run 3-4 times per task |
| 6 | Polling bug in the main session (`pgrep -f` matching its own ssh) | about 575-1000 s of main-session wall, one event | [M] |
| 7 | ssh to shared-server | 0.8-4.8% | [M] cheap per call |
| 8 | Pre-commit hook (plugin-only 1-3 s; `.nix` 6-12 s warm) and gate (0.2-1.5 s) | about 1-2% | [M] not a bottleneck |
| 9 | kb itself (docs/audit/gaps 0.2-0.8 s) | under 0.5% | [M] |

## Optimization candidates

| # | Change | Expected saving | Risk |
|---|---|---|---|
| 1 | **Cached dev environment**: one `nix print-dev-env > $WT/.git/devenv.sh` (or a shared file keyed by the hash of flake.lock + generated.json) and a tiny `scripts/dev-env` helper that sources it. Document it in CLAUDE.md as the way to get kb and the lint tools. Replaces 40 per-call `nix develop` runs. | about 1000 s per 4-builder round (10-23 s per call to 0.3 s); removes most STALE_TOOL failures and the guard blocks | Low. Re-generate when the lock or pin changes (key on a hash). Stale env if forgotten, but the gate still checks the version. |
| 2 | **Keep the Mac's kb at the pin**: have `rebuild` (or a login-time job) update kb, or make the gate accept the dev-shell kb when PATH kb is stale, with a one-line hint "source scripts/dev-env". Or relax equality to `>=` pin for the Mac only. | removes the failing-by-default gate on the Mac; avoids about 10 STALE_TOOL failures per round | Low-medium. Relaxing equality weakens the "same kb everywhere" rule; prefer auto-re-exec into the cached env. |
| 3 | **Make the hook and gate re-exec themselves into the cached env** when `kb` is stale (instead of failing). | saves the rebuild-edit-retry turn (about 10 s model time each) | Low |
| 4 | Fix agent guidance: do not wrap git/commit in `nix develop` (harness guard blocks it); use the cached env or `PATH=... git commit`. Add this to CLAUDE.md. | 81 blocks (about 8-13 min of wasted turns) | None |
| 5 | **Fast plugin-dev loop**: `bb plugin dev <path>` (watch + rebuild + reload) and `bb plugin install <path>` from the worktree for testing, instead of commit, push, ssh pull, rebuild, check. A plugin-only rebuild gains nothing for plugin source (see section 4 finding). Only use `rebuild` when `.nix` changed. | about 15-25 s per remote iteration, plus the polling waits and ssh turns (about 1-3 min of model turns per iteration) | Low. A local install touches the live bb server; use a throwaway plugin id. |
| 6 | For `.nix` commits, run **flake check once** (in the hook), not by hand before the hook. Tell builders to rely on the hook for the final run, and use `nix eval`/`nixfmt` for iteration. | about 40-100 s per task (3-4 redundant runs) | Low |
| 7 | Skip `nix flake check` when only non-eval-relevant `.nix` (docs-only comments) changed. Not recommended: the `.nix` set is small, the check is the only eval of NixOS configs, and the hook is 6-12 s warm. | under 10 s per commit | Medium (misses real breakage). Skip this one. |
| 8 | Scope statix/deadnix/nixfmt to staged paths. | under 1 s, they are already 0.2-0.4 s | Not worth it. Do not do this. |
| 9 | Fix the rebuild polling idiom: poll the log for `^Done\.|error:` (or `systemctl is-active`) rather than `pgrep -f`; put it in a helper or CLAUDE.md. | removes a 10-17 min failure mode (one occurrence today) | None |
| 10 | Give builders a pre-warmed worktree recipe: `npm ci` (full, not `--omit=optional`) once per plugin (cache in `~/.npm`), and reuse `node_modules` via a shared install or `git worktree` symlink where the lockfile matches. | first install 55-121 s to about 5-11 s | Low-medium (symlinked node_modules across worktrees). The npm cache alone is safe. |
| 11 | Make `installBbPlugins` also run when a plugin's tracked files change (include the plugin tree hash in the HM activation's inputs, e.g. via `home.activation` text or a `builtins.path` hash), or document that plugin-only changes need `bb plugin install`. | removes a silent no-op rebuild | Medium (HM inputs change on every plugin edit, so every plugin edit becomes a HM generation change, which is fine and cheap here) |
| 12 | For design checks on the NixOS config (bb split), use `nix eval` against one evaluated `config` kept in one expression, or `nix repl`, not a fresh whole-host eval per question (11-85 s each, 20 times). | about 5-6 min for split-like tasks | Low |
| 13 | Skip the duplicate `check_env` in `record` when the hook's parent already ran `session` (cache by the PATH-kb version). | about 0.3 s per commit | Negligible; do not bother. |
| 14 | Reduce model turns: batch independent commands (many builder turns are single `Read`/`Edit`/`ls`), run verify once per change group, and avoid `sleep`/poll turns (use background commands with a notify). | the largest lever (model time 51-77%), but not measurable here | Low |

## Honest caveats

- Load: the first half of the direct measurements ran at load average 21-43, so cold numbers are inflated. The quiet-machine numbers (load under 10) are given where I have them.
- "Cold" for a fresh worktree means a new flake source (eval cache miss), not a cleared nix store.
- Model time is the residual (wall minus tool time), so it includes harness latency, queueing and user-approval waits that I cannot separate.
- Section 4 totals are start-to-switch estimates from the main-session tool timestamps and the journal; the logs carry no timestamps. The "no HM activation for plugin-only edits" finding is inferred from absent journal lines.
- I did not run `bb plugin install` locally or on the server (it mutates the live bb install), so the install time is from the journal.
- The 603 s `nix build .#kb` outlier is unexplained.

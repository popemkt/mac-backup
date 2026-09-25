# Wave 2026-09-24: paused, how to resume

Paused 2026-09-25 at the user's request, to free tokens. Nothing is running.
`main` is local at the commit that adds this file. `origin/main` is at
`3595ecfa` (pushed), and the local commits after it are docs only.

## Where things stand

- **Done and pushed:** items a–g and the pin-verify change. See the status
  table in `plan.md`.
- **CI:** `Validate` on `3595ecfa` shows `kb` passing and `nix` failing. The
  failing step is "Verify generated release sources": the `github-sources` app
  exits 1 without printing anything on the runner. A local repro is a clean
  clone run under `env -i HOME=$(mktemp -d)`. The fix is in progress; see PINS
  below.
- **Closing audit:** the report is `reports/closing-audit.md`. It lists P0 to
  P3 findings and five fix packages, WP1 to WP5.

## Paused work (one worktree and branch each)

Worktrees live under `.claude/worktrees/`. Each branch is based on `21182dad`,
except PINS.

| Unit | Agent id (for SendMessage in the same session) | Worktree / branch | State |
|---|---|---|---|
| PINS: CI verify fix | `a907fe779cb9c9454` | `agent-a907fe779cb9c9454` | 3 commits: `47212b00` (run under the app's bash), `5ee4f2e2` (every failure is reported, cleanup on every exit), `66623832` (fixture test on the flake app). Not reviewed yet. **Next:** grok review, then land, push, and watch `Validate`. |
| WP1: store, rank, writes | `a9cdaa996f44b4b11` | `agent-a9cdaa996f44b4b11` | Not started; no commits. |
| WP2: live sync CLI→UI | `afa9e224bc5baa7b8` | `agent-afa9e224bc5baa7b8` | Reproduced: the CLI write is not seen on JSONL but is seen on sqlite. `5e667dc9` is a **WIP** commit holding the red test (made with `--no-verify` on purpose). Next idea from the agent: drop the watcher's filename filter and let the fingerprint-guarded ingest decide. Rewrite the WIP commit before landing. |
| WP3: outline text, colour, states | `aee1500ce693554dd` | `agent-aee1500ce693554dd` | Not started; no commits. |
| WP4: graph and scene kit | `a865b1977075724bb` | `agent-a865b1977075724bb` | Not started; no commits. |
| WP5: tests, CI, docs | `aba24b2ce57485416` | `agent-aba24b2ce57485416` | Not started; no commits. |

Agent ids only work in the session that spawned them. In a new session,
start a fresh agent in that worktree and point it at this file, the audit
report, and the package brief below.

## Briefs and tooling (outside the repo)

All of these are in `~/.cache/kb-wave-2026-09-24/`:

- `wp-preamble.md`: the shared rules every fix package follows.
- Package scopes: the "Work packages" section of the audit report, plus the
  defaults below.
- `orca-review.sh <worktree> <base> <name>`: runs grok-4.7 in an Orca tab and
  waits for and collects the review. Its prompt is `review-prompt.md`.
- `land.sh <worktree> <name> [--render]`: rebases onto `main`, resolves the
  node stores and docs, reinstalls, runs every check, then fast-forwards
  `main`.
- `ci-replay.sh`: replays `validate.yml` on a clean clone.
- `audit-notes.md`, `audit/`: the audit's evidence.

## Decisions

Defaults the orchestrator already chose, so they are not user decisions:

- **D-1:** variable-length ranks plus a one-time re-rank.
- **D-3:** `test:render` gates CI once it is stable.
- **D-6:** opening a store never writes.
- **D-7:** fields can declare `cardinality: one`.
- **D-8:** `scene/` stays React-free.
- **D-10:** Stryker covers wider scope.
- **D-11:** one import-boundary rule.

Decided by the user:

- **D-2:** keep `tools/kb/.kb`. kb uses kb for its own development, so the
  nested store is intended. P1-13 becomes something else: make it deliberate
  and visible, for example state which store a command writes to, rather than
  delete it.

Still waiting for the user:

- **D-4:** the status table becomes a kb view, or stays orchestrator-only.
- **D-5:** home's wall of about 100 `GAP:` rows goes under a parent index, or
  behind a filter.
- **D-9:** 3D as the first-visit renderer, and a light-mode stage.
- **D-12:** the pre-paint script is generated.
- **D-13:** the walkthrough HTML is deleted or regenerated.
- **D-14:** design systems and plugins become nodes.

## Model strategy (user's choice)

- **Sonnet 5** (`model: "sonnet"`) for mundane work:
  - landing, rebasing and resolving the node stores;
  - CI replays and watching runs;
  - status and doc upkeep;
  - mechanical migrations;
  - evidence and screenshot capture;
  - harvesting and relaying reviews.
- **Opus** for code generation:
  - the fix packages WP1–WP5 and the PINS fix;
  - any design or refactor work;
  - fixes answering review findings.
- **Reviews** use grok-4.7 through `omp`. When grok is out of budget, a fresh
  Opus reviewer takes over.

## Process lessons (carry forward)

- Launch every review through `orca-review.sh` in the background, so its
  result wakes the orchestrator. One review sat unread for hours.
- Replay CI only on a clean clone. `statix` walked 7.7 GB of worktrees.
- The worktree tool branches from `origin/main`, so every brief must start
  with a reset to local `main`.
- After a landing that adds dependencies, run `bun install` on `main`.

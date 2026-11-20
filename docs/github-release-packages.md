# Direct Release Packages

Direct release binaries are pinned and updated through `nvfetcher`. Versions
can be discovered from GitHub releases or an upstream webpage such as Cursor's
install page. This is separate from flake inputs, Homebrew, npm, and uv, which
keep their own update mechanisms.

## Layout

| Path | Responsibility |
|---|---|
| `nvfetcher.toml` | Declares upstream version sources and release asset URLs |
| `_sources/generated.nix` | Generated Nix sources, versions, and hashes |
| `_sources/generated.json` | Machine-readable current source state |
| `pkgs/<name>/default.nix` | Turns a generated source into a Nix package |
| `pkgs/default.nix` | Exposes local packages to the flake overlay |
| `scripts/github-sources` | Freshness, consistency, provenance, and intentional updates |

Never edit files under `_sources/` manually.

## Commands

The commands answer two different questions, and each question has exactly one
command.

### Pin-tool contract

`github-sources` and `uv-sources` both expose `check` and `update`.
`check` leaves the pins untouched. Exit 10 reports a resolved update for a
movable pin, even if another source could not be resolved. If there is no
resolved update and a source is unavailable, exit 20 reports that the check
could not complete. With `check --best-effort`, that case warns and exits 0.

`update` applies resolved versions to movable pins and exits 0 on success.
An upstream resolution failure exits 20. Usage and setup errors exit 2.
A held pin may be reported without requiring an update. The `pins are current`
message is the freshness verdict when there are no known pending updates or
unavailable pins. A GitHub check can also report newer versions excluded by
source filters or an unprobed filter.

**GitHub freshness.** `check` resolves every GitHub source, including held
pins, through the same nvfetcher configuration as `update`. Because nvfetcher
prefetches what it resolves, the first `check` after an upstream release
downloads that artifact once; nvfetcher records the prefetch in its shared
database (`~/.local/share/nvfetcher`), so later runs and `update` reuse it.
That database takes a lock, so two nvfetcher runs on one machine at once (a
`check` and a `verify`, say) make the second fail with exit 20; run them one
after the other. Only the scheduled updater acts on the answer (see [Scheduled Updates](#scheduled-updates)); no
commit or push gate asks it, because upstreams publish on their own schedule
and a nightly would otherwise keep every gate red.

```bash
nix run .#github-sources -- check
```

**Consistency — are the committed sources what `nvfetcher.toml` generates at
the pinned versions?** `verify` rewrites every source's version source to the
version `_sources/generated.json` records, regenerates in a temporary
directory, and requires both generated files to match byte for byte. That
proves the fetch URLs, hashes, and both generated files agree with
`nvfetcher.toml`, and that generation is reproducible. It downloads the pinned
artifacts but never asks upstream what is newest, so it gives the same answer
whenever it runs. It exits 11 on a mismatch, including a configured source
with no pin, and 20 when nvfetcher cannot run. `--best-effort` passes with a
warning only when a pinned artifact's host cannot be reached at all.

```bash
nix run .#github-sources -- verify
```

**Provenance.** Run `provenance` after `verify`. For each pin with
`passthru.provenanceRepo`, `passthru.provenanceSignerWorkflow`, and
`passthru.provenanceSourceRef` in `nvfetcher.toml`, the command downloads the
pinned artifact, checks its SHA-256 digest, and asks GitHub CLI to verify its
signed build attestation against that policy. The flake app includes GitHub
CLI. Sign in with `gh auth login` locally or supply `GH_TOKEN` in CI.

```bash
nix run .#github-sources -- provenance
```

A hash mismatch or missing or nonmatching attestation exits 11.
Unavailable verification, including offline downloads or GitHub API
failures, exits 20. Use `provenance --best-effort` to warn and continue for
unavailable verification. CI and `update-system` require the strict check.

The exit statuses above (and 2 for usage or setup errors) each come with a
message; any other exit is a failure nothing reported, and the script says so
and prints the tail of the nvfetcher logs it left. The flake check
`pin-tools-check` runs the same contract cases for GitHub and uv without
network access. Its GitHub-specific suite runs the flake app with fixture
stubs for nvfetcher and GitHub CLI under `env -i`, an empty `HOME`, no
`TMPDIR`, and `PATH=/usr/bin:/bin`. It covers freshness, consistency, and
provenance verdicts.

Update every source, or one named source:

```bash
nix run .#github-sources -- update
nix run .#github-sources -- update cli-proxy-api
```

An update changes `_sources/generated.nix` and `_sources/generated.json`. Review
those changes, then run the normal Nix validation and build the affected
package.

## Pre-commit Behavior

The pre-commit hook materializes the exact Git index into a temporary directory,
so unstaged working-tree content cannot make a partial commit pass. A commit
that changes `nvfetcher.toml`, `_sources/`, or `pkgs/` runs
`verify --best-effort` against that staged snapshot, and verify's exit status
alone decides: any failure blocks the commit, and only `--best-effort`'s
unreachable-host case warns and passes. Freshness runs on its own schedule,
and provenance runs in CI and during update preparation.

The hook never updates or stages files. Updates are explicit so their diffs can
be reviewed.

When `GITHUB_TOKEN` is available, `check` and `update` pass it to nvfetcher
through a mode-0600 temporary nvchecker keyfile. The keyfile is
removed after the command and is never stored in the repository or printed.

## Scheduled Updates

`.github/workflows/update-github-sources.yml` is the one place freshness is
acted on. It runs every two days and can also be started manually. It
refreshes all sources with `update`, validates the repository, builds the
packages on Apple Silicon macOS, opens one pull request, and squash-merges that
PR after the updater's validation passes. When no source changed, it does not
open a pull request.

`.github/workflows/validate.yml` runs `verify` on every pull request and push
to `main`, so it stays green while upstreams move. The updater runs the same
`verify` on its fresh output before opening its pull request because GitHub
suppresses workflow events from pull requests created with the default
`GITHUB_TOKEN`. Defining an
`UPDATE_GITHUB_SOURCES_TOKEN` repository secret with contents and pull-request
write access lets updater pull requests trigger the normal PR workflow too.

## Holding Back Releases

Nothing is frozen: a hold narrows which releases a source follows, and the
scheduled updater keeps moving it within that range.

- **Exclude a kind of release** (prereleases, betas): track tags with
  `src.github_tag` and admit only the wanted versions with `src.include_regex`.
  `update` resolves the newest admitted tag, so the next stable release lands
  through the scheduled PR without anyone touching the config. For every
  source that declares a list filter (`src.include_regex`,
  `src.exclude_regex`, `src.ignored`), `check` resolves it a second time with
  those filters removed; when that answer differs, it prints a line naming the
  excluded release and counts it in its summary. That probe resolves versions
  only: its fetch points at the committed artifact, so an excluded release is
  never downloaded. It annotates and never decides: if it fails, `check`
  warns that the hold is unprobed and still reports the freshness verdict and
  exit status from the real configuration. A hold never disappears
  silently. `chat2db` follows stable
  releases this way; the reason sits beside it in `nvfetcher.toml`.
- **Freeze at one version** only when a human must decide each move: set
  nvfetcher's `pinned = true` on the source. `update` then keeps the committed
  version, and `check` keeps reporting the newer upstream (exit 10) for as
  long as the pin lasts.

## Rebuild And Update Behavior

The `rebuild` shell wrapper only applies declared state. It does not check for
new releases or upgrade Homebrew, npm, or Bun packages. Nix reuses existing
store paths, so repeated rebuilds do not reinstall unchanged direct packages.
A cold Nix store may still need network access to download a pinned artifact.

The `update-system` wrapper prepares a reviewable repository change: it
refreshes flake inputs and direct-release pins, verifies consistency and
provenance, and evaluates the flake without mutating the live system. Inspect or revert the
result before proceeding.

`apply-system-update` activates the prepared pins, then upgrades the declared
Homebrew bundle with serial downloads and refreshes declared npm and Bun
globals. Keeping preparation and application separate prevents an upstream pin
change from being activated before its repository diff has been inspected.

`upgrade-out-of-band` covers host surfaces the flake cannot own: it upgrades
Determinate Nix when outdated, and lists (never silently installs) macOS
Software Update labels.

## Packages Pinned By Hand

A release that is never pruned and has no use for a bot can be pinned in its
own `pkgs/<name>/default.nix` instead: a `version` and a `hash` at the top, a
`fetchurl`, and a comment saying how to bump them. It has no entry in
`nvfetcher.toml` and nothing under `_sources/`, so `check`, `verify` and the
scheduled updater never see it, and nothing tells you a newer release exists.
`marginalia` is the one such package
([marginalia-service.md](marginalia-service.md)); every other package follows
the steps below.

## Adding an Application

1. Add an entry to `nvfetcher.toml` with a version source and fetcher.
2. Run `nix run .#github-sources -- update <name>`.
3. Add `pkgs/<name>/default.nix` using the generated source. For a GitHub
   release, take `meta.homepage` from `source.homepage`: `pkgs/default.nix`
   derives it from the pinned release URL, so the repository is named once.
4. Export it from `pkgs/default.nix`.
5. Add a focused runtime/config module when the application needs services,
   config files, environment variables, or activation behavior.
6. Confirm `nix flake check` builds it through the automatically exported flake
   checks.

The `src.*` keys are the whole version source: `check`, `verify`, and
`update` all resolve through nvfetcher, so nothing else needs to describe it.
A GitHub release:

```toml
[example]
src.github = "owner/repository"
src.from_pattern = "^v(.+)$"
src.to_pattern = "\\1"
fetch.url = "https://github.com/owner/repository/releases/download/v$ver/example_$ver_darwin_aarch64.tar.gz"
```

A webpage-backed version:

```toml
[example]
src.webpage = "https://example.com/install"
src.regex = 'downloads\.example\.com/([^/]+)/\$\{OS\}'
fetch.url = "https://downloads.example.com/$ver/darwin/arm64/package.tar.gz"
```

Credentials, OAuth tokens, databases, caches, and other mutable application
state do not belong in generated sources or the Nix store. Keep them in their
runtime locations and either re-authenticate after restore or back them up
securely.

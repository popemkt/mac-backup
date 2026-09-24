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
| `scripts/github-sources` | Freshness checks, consistency verification, and intentional updates |

Never edit files under `_sources/` manually.

## Commands

The commands answer two different questions, and each question has exactly one
command.

**Freshness — is there a newer upstream release?** `check` resolves every
source with nvfetcher from the real `nvfetcher.toml` into a temporary
directory — the same resolution `update` performs, so the two cannot disagree
— and exits 10 when a resolved version differs from its pin. A source nvfetcher
cannot resolve exits 20 (a warning with `--best-effort`). Because nvfetcher
prefetches what it resolves, the first `check` after an upstream release
downloads that artifact once; nix caches it for later runs and for `update`.
Only the scheduled
updater acts on the answer (see [Scheduled Updates](#scheduled-updates)); no
commit or push gate asks it, because upstreams publish on their own schedule
and a nightly would otherwise keep every gate red.

```bash
nix run .#github-sources -- check
```

**Consistency — are the committed sources what `nvfetcher.toml` generates at
the pinned versions?** `verify` rewrites every source's version source to the
version `_sources/generated.json` records, regenerates in a temporary
directory, and requires both generated files to match byte for byte. That
proves the fetch URLs, passthru, hashes, and both generated files agree with
`nvfetcher.toml`, and that generation is reproducible. It downloads the pinned
artifacts but never asks upstream what is newest, so it gives the same answer
whenever it runs. It exits 11 on a mismatch, including a configured source
with no pin, and 20 when nvfetcher cannot run. `--best-effort` passes with a
warning only when a pinned artifact's host cannot be reached at all.

```bash
nix run .#github-sources -- verify
```

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
`verify --best-effort` against that staged snapshot; a mismatch blocks the
commit, and an unreachable network warns and passes. The hook never runs
`check`: freshness does not decide whether a commit lands.

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
  excluded release and counts it in its summary. A hold never disappears
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
refreshes flake inputs and direct-release pins, verifies the generated sources,
and evaluates the flake without mutating the live system. Inspect or revert the
result before proceeding.

`apply-system-update` activates the prepared pins, then upgrades the declared
Homebrew bundle with serial downloads and refreshes declared npm and Bun
globals. Keeping preparation and application separate prevents an upstream pin
change from being activated before its repository diff has been inspected.

`upgrade-out-of-band` covers host surfaces the flake cannot own: it upgrades
Determinate Nix when outdated, and lists (never silently installs) macOS
Software Update labels.

## Adding an Application

1. Add an entry to `nvfetcher.toml` with a version source and fetcher.
2. Run `nix run .#github-sources -- update <name>`.
3. Add `pkgs/<name>/default.nix` using the generated source.
4. Export it from `pkgs/default.nix`.
5. Add a focused runtime/config module when the application needs services,
   config files, environment variables, or activation behavior.
6. Confirm `nix flake check` builds it through the automatically exported flake
   checks.

For GitHub releases, use `passthru.github` and `passthru.tagPrefix` to let
`scripts/github-sources` perform its lightweight freshness check:

```toml
[example]
src.github = "owner/repository"
src.from_pattern = "^v(.+)$"
src.to_pattern = "\\1"
fetch.url = "https://github.com/owner/repository/releases/download/v$ver/example_$ver_darwin_aarch64.tar.gz"
passthru = { github = "owner/repository", tagPrefix = "v" }
```

For a webpage-backed version, provide the page and a capture expression both
to nvfetcher and to the lightweight checker:

```toml
[example]
src.webpage = "https://example.com/install"
src.regex = 'downloads\.example\.com/([^/]+)/\$\{OS\}'
fetch.url = "https://downloads.example.com/$ver/darwin/arm64/package.tar.gz"
passthru = { versionUrl = "https://example.com/install", versionRegex = "downloads.example.com/([^/]+)/" }
```

Credentials, OAuth tokens, databases, caches, and other mutable application
state do not belong in generated sources or the Nix store. Keep them in their
runtime locations and either re-authenticate after restore or back them up
securely.

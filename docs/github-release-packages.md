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

Check every tracked release without changing the working tree:

```bash
nix run .#github-sources -- check
```

Prove that `nvfetcher.toml`, the latest releases, and both generated files
agree, without changing the working tree:

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
so unstaged working-tree content cannot make a partial commit pass. It then
performs an uncached, best-effort release check:

- current pins pass
- no internet, GitHub failure, or rate limiting warns and passes
- outdated pins warn for unrelated commits
- outdated pins block commits that change `nvfetcher.toml`, `_sources/`, or
  `pkgs/`
- source/package changes also run `verify` against the staged snapshot, proving
  that the committed generated files match the committed configuration

The hook never updates or stages files. Updates are explicit so their diffs can
be reviewed.

When `GITHUB_TOKEN` is available, `scripts/github-sources` passes it to
nvfetcher through a mode-0600 temporary nvchecker keyfile. The keyfile is
removed after the command and is never stored in the repository or printed.

## Scheduled Updates

`.github/workflows/update-github-sources.yml` runs weekly and can also be
started manually. It refreshes all sources, validates the repository, builds
the packages on Apple Silicon macOS, and opens one pull request. It does not
auto-merge.

`.github/workflows/validate.yml` independently verifies every pull request and
push to `main`. The updater repeats the same source verification before opening
its pull request because GitHub suppresses workflow events from pull requests
created with the default `GITHUB_TOKEN`. Defining an
`UPDATE_GITHUB_SOURCES_TOKEN` repository secret with contents and pull-request
write access lets updater pull requests trigger the normal PR workflow too.

## Rebuild Behavior

The `rebuild` shell wrapper first performs the same best-effort freshness check
and reports the explicit update command when a newer release exists. Failure or
lack of internet never blocks activation, and the check never changes files.
The subsequent `darwin-rebuild` only consumes pinned generated sources, keeping
system activation deterministic. A cold Nix store may still need network access
to download the pinned release asset or other missing Nix inputs.

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

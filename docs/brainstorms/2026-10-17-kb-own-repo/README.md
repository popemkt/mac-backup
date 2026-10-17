# kb moves to its own repository

Date: 2026-10-17. Status: plan, for the owner to approve. Nothing has moved.

## Why now

kb has outgrown being a tool inside the dotfiles:

- **History:** 1290 of the repo's 1897 commits touch `tools/kb`. 966 of them touch nothing else.
- **Data:** about 90% of the root `.kb` store is about kb itself: about 235 of the 253 gaps, about 77 of the 102 todos, about 30 of the 36 rules, and 24 of the 25 checks.
- **CI and the hook:** kb dominates both. The `kb` job is most of Validate's time, and the hook's `verify` lane runs on every commit that touches kb.
- **The tooling is already self-contained:** the Bun workspace, nx, oxlint, tsconfig, knip and Stryker all live under `tools/kb`, and nothing is shared with a root `package.json`.

The dotfiles keep using kb, as an installed tool over their own small store. Their data is about 2 archived nodes, about 25 todos, about 10 gaps, 6 repo-wide rules, the project node and its schema.

## Target shape

| | kb repository (`popemkt/kb`) | dotfiles |
|---|---|---|
| Code | today's `tools/kb`, at the root | none |
| Store | today's `tools/kb/.kb` (dev and test store), plus every kb node moved out of the root store (gaps, todos, rules, checks, design nodes, approval policies) | its own `.kb`: the dotfiles nodes only |
| Docs | `DESIGN*.md`, `AGENTS.md`, the kb brainstorms, `docs/kb/waves` and `research`, `kb-service.md` | `docs/kb/{rules,todos}.md` generated from its own store; links to the kb repo |
| Build | its own `flake.nix`: `packages.kb`, a devShell (bun, jq, playwright), the `bun2nix` input and the per-host `bun.nix` slicing | `inputs.kb.url = "github:popemkt/kb"`; `pkgs.kb` comes from that input |
| CI | the whole kb job, plus kb-mutation | a small "kb data" job: `kb docs check` plus the assets-backup check, using the input's binary |
| Hooks | its own pre-commit (the verify lane) | the docs-check and assets lanes only, calling the installed `kb`; the `verify` lane and `link_node_modules` are deleted |
| Runs on the machine | — | the `my.stacks.kb` modules stay, unchanged apart from where `pkgs.kb` comes from |

## Decisions (recommendations; the owner decides)

1. **Split the store, don't share it.** Each repo owns the nodes about itself.
   - kb's GAP markers cite about 111 ids, and they must resolve in kb's own store (the `gap-markers-resolve` harness).
   - The dotfiles' gaps are about the dotfiles.
   - The alternative, one store with the dotfiles as a client of a kb root, would couple the two repos' commits again.
2. **The shared engineering rules get one home: the kb repository.** These are Rule 1, one contract for every implementation, canonical statements, and drift markers and gaps. They were written while building kb, and the kb repo is where they gate code.
   - The dotfiles `AGENTS.md` keeps one paragraph saying the rules apply here too, plus a link. It doesn't restate them.
   - The dotfiles store's `#rule` nodes name those homes by URL. That needs `ext.check.audit` to accept a URL home (today it resolves only files). That's a small, clean addition: a home is a file, or a URL that is only checked for form.
3. **History is preserved** with `git filter-repo`:
   - `tools/kb` becomes the root (`--subdirectory-filter`-style `--path-rename tools/kb/:`);
   - plus the kb brainstorms, `docs/kb/waves`, `docs/kb/research` and `docs/kb-service.md`.
   - The root `.kb/nodes.jsonl` history is not carried over, because it mixes both repos' nodes. The kb repo's store starts from the split snapshot, and the full history stays readable in the dotfiles.
4. **Visibility: private** (my default; your call).
5. **The repo layout stays flat.** `packages/…` sits at the root, the store is `.kb/`, and there is no new nesting.

## Steps

Each step is a separate landing, and every gate stays green between them. Steps 1–3 happen inside the dotfiles and are fully reversible. The cut is step 4.

0. **Freeze.** Land or park every in-flight kb branch. `filter-repo` rewrites SHAs, so a branch cut from the old history must be finished first or replayed by hand.
1. **Restructure: kb reads nothing outside `tools/kb`.**
   - Harness tests read their own workspace. Today they read the repo root:
     - `gap-markers-resolve` reads `tools/kb/.kb`;
     - `bun-nix-current` reads a kb-local flake (step 2);
     - `advisory-signals` and `gitignore-covers-derived` read a kb-local workflow and `.gitignore`;
     - ext-check's `SURFACE_FILES` drops its `tools/kb/` prefixes and the root hook.
   - The snapshot ratchet's fork-point base stays `main`.
2. **Restructure: a kb sub-flake.**
   - `tools/kb/flake.nix` owns `packages.kb` (today's `pkgs/kb` and `host-bun-nix.nix`), the devShell and the `bun2nix` pin.
   - The root flake consumes it as `inputs.kb.url = "path:./tools/kb"`. `pkgs/kb` and the root's `bun2nix` input are deleted.
   - CI's kb job runs `nix develop ./tools/kb`.
3. **Data: move kb's nodes into kb's store.**
   - A one-time move, through kb's own write path: each node is deleted from the root store and created in `tools/kb/.kb`, with its id kept. Classify by tag and by what each node names, then review the list by hand, since about 18 nodes are borderline.
   - Rule homes are rewritten:
     - `tools/kb/X` becomes `X`;
     - the four shared rules point at `tools/kb/AGENTS.md`, which takes the text out of the root `AGENTS.md`;
     - the root `AGENTS.md` keeps the pointer paragraph.
   - URL homes are added to `ext.check.audit` (decision 2).
   - The kb docs move next to kb: the brainstorms, `docs/kb/waves`, `research` and `kb-service.md` go to `tools/kb/docs/`. Their citations are rewritten.
4. **The cut.**
   - Run `git filter-repo` on a fresh clone, keeping `tools/kb` (now self-contained) and the paths step 3 moved under it.
   - Create `popemkt/kb` and push.
   - Move the workflows: `validate.yml`'s kb job and `kb-mutation.yml`.
   - Register the repo in Orca.
   - First CI run green in the new repo.
5. **Dotfiles switch.**
   - The flake input becomes `github:popemkt/kb` and `flake.lock` is updated.
   - Delete `tools/kb`.
   - The hook's docs-check calls `kb docs check`.
   - `.gitattributes`' merge driver becomes `kb merge-jsonl`. The binary has to expose it as a subcommand, so make that addition in step 1.
   - `.envrc` drops `PATH_add tools/kb/bin`, which also closes the "two launch paths" gap.
   - `.mcp.json` runs `kb mcp` from PATH.
   - Rewrite the kb parts of `docs/ci.md`, `README.md` and the specs.
   - `scripts/deadnix-repo` drops `bun.nix`, and `intent/gate.sh` drops the `pkgs/kb` exclusion.
   - Validate's `kb` job becomes "kb data".
   - **Manual for the owner:** branch protection's required contexts become `nix` and the new data job (see `docs/ci.md`).
6. **Local development.**
   - The checkout is `/Volumes/Data/workspace/repos/kb`.
   - To work on kb against the dotfiles without publishing, run `nix build --override-input kb path:/Volumes/Data/workspace/repos/kb`.
   - Builders and Orca worktrees live in the kb repo from then on, so the dotfiles' worktrees stop paying kb's 1.9 GB `node_modules`.

## What stays coupled, on purpose

- The dotfiles run kb. The `my.stacks.kb` modules, the launchd `kb ui` service, Tailscale's `svc:kb`, and Mackup's `.kb/assets` and `trust.json` entries all stay in the dotfiles. They are about this machine, not about kb.
- `check-kb-assets-backup.sh` stays in the dotfiles. It guards the dotfiles' own data root.

## Risks

- **Rewritten SHAs:** anything that cites a commit by SHA (plans, review records) keeps pointing at the dotfiles' history. That's acceptable; say so in the kb repo's README.
- **`bun.nix` per-host slicing** (`host-bun-nix.nix`) is the one awkward build piece. Step 2 moves it first and proves it before the cut.
- **The borderline nodes** in step 3 need human judgment. The move is reviewable as one diff of ids.
- **Timing:** about half a day of builder time in total. Steps 1–3 are three builders' worth of work, mostly in parallel. Steps 4–5 are sequential and fast.

## Questions for the owner

1. Repository name and visibility: `popemkt/kb`, private?
2. Should the shared engineering rules live in the kb repo, with the dotfiles linking to them (recommended)? Or the other way round?
3. Should the dotfiles keep their own store, for todos, gaps and archived software (recommended), or move those to plain files?

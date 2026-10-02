# Resume: roadmap build, state at 2026-10-02

Decisions and order are in [README.md](README.md); the kb roadmap todo is
`01M3Q531V167YVKRF4XBYG1MTK`. Main is `86b4e14b` (local, not pushed).

## Merged

Steps 0 (action modes), 1 (view types in ViewPoint), 4 (WebMCP), 8 (canvas
3D). Their gaps are minted and their markers are written as ids.

## Built, waiting for review (owner: review with GPT-6.1 Sol, then merge)

| Step | Branch / worktree | State |
|---|---|---|
| 2: view nodes | `worktree-agent-a60d61459a62adc94` (`.claude/worktrees/agent-a60d61459a62adc94`) | Two Sonnet review rounds' fixes applied; verify green (762 / 2024 UI); based on `86b4e14b`. Includes migration-output commits to `.kb/nodes.jsonl` and `tools/kb/.kb/nodes.jsonl` (`3761daed`, `0c14f37d`): merge by fast-forward, or re-run `views.migrate` if main's kb data moved. |
| 5a: screen state | `worktree-agent-abf2e57039b6bab45` (`.claude/worktrees/agent-abf2e57039b6bab45`) | Security review fixes applied: one request guard on `/ws` and `/api/*`, tab ownership, `.kb/ui.json` root identity; verify green (759 / 1990 UI); based on `86b4e14b`. |

Review focus:
- Step 2: migration data fidelity, opening never writes, and docs-view naming.
- Step 5a: the request guard (Origin, Host, content-type), tab ownership, and `/api/identity`.

## After merge: kb bookkeeping

- Mint `#gap` nodes for these placeholders, and rewrite each marker as `GAP [[id]]`:
  - Step 2: `GAP-VIEW-OPTION-SEEDS`, `GAP-ORPHAN-VIEW-NODES`, `GAP-LEGACY-DOCS-VIEWS-IMPORT`.
  - Step 5a: `GAP-SCREEN-VIEW-NODE`, `GAP-OPEN-NODE`, `GAP-SCREEN-CANVAS-3D`.

  `grep -rn 'GAP \[GAP-' tools/kb` lists the sites.
- Mark these done:
  - gap `01M3R2KDKN1EFE87R1K8CG3NPE` (`/api/action` Origin check, closed by 5a's guard);
  - gap `01M3R5NKA34ATJKJV9GVQRS16Z` (renderer draws only inside a graph host, closed by step 2);
  - roadmap steps 2 (`01M3Q55REYP6XYWJWSXYYW4TSZ`) and 1 (`01M3Q53GPBMSDF8MJ4BZKPB6FQ`).
- Re-scope `01M3FK1PM9P96SNCSHXF0CJZRA` (seed retirement): the view migration retires its own seeds, but there is still no general retirement table.
- Then `kb action-invoke '{"id":"docs.materialize","input":{}}'` and commit.

## Not started

Step 3 (generative UI mode A), 5b (agent packages and sidebar), 6 (layout view
type), 9 (sandbox), 10 (chart view), and the "which actions require approval"
todo. Step 7 is deferred by the owner.

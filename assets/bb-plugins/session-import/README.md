# bb-plugin-session-import

Import a Claude Code session from any machine bb reaches as a new bb thread, seeded with its cleaned
transcript. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what a person gets, and
[docs/research/2026-10-27-claude-session-import.md](../../../docs/research/2026-10-27-claude-session-import.md)
for why it is shaped this way.

## Layout
| File | Role |
|---|---|
| `core/transcript.ts` | The session reader (records → turns, across compactions and rewinds), the Markdown, and the budget cuts. Pure. |
| `core/mapping.ts` | Which project, machine and directory a thread runs in. Pure. |
| `contract.ts` | The server ↔ host RPC contract. |
| `host.ts` | Host entry: lists sessions (Agent SDK `listSessions`), streams one through the reader, reads one tool output again, probes a cwd, writes the transcript file in the plugin's data dir. Never writes under `~/.claude`. |
| `server.ts` | Machines, projects, the "already in bb" index, preview, the import (`threads.spawn`), the import records, `bb session-import`. |
| `app.tsx` | The picker (nav page and New thread panel action) and the Original session thread panel. |
| `skills/session-import/` | Tells agents about `bb session-import`. |
| `tests/` | `npm test`: core over synthetic fixtures, host over a temporary config dir, server in bb's fake plugin host. |

## Develop
```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb-plugins-sync --path "$PWD"     # try it in the running bb; the next sync or rebuild restores the declared set
```

Fixtures in `tests/fixtures/` are synthetic. Never commit content from a real session.

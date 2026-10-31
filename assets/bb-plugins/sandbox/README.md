# sandbox (proof of concept)

Runs a command in an isolated, resource-capped sandbox, behind one provider contract and an
admission queue. The design it proves out (providers, jobs, fan-out of builder threads, a sandbox
machine provider, the NixOS side) is
[docs/research/2026-10-31-sandboxes.md](../../../docs/research/2026-10-31-sandboxes.md).

- `core/contract.ts`: the contract every provider implements (create, exec, files, ports,
  pause/snapshot, destroy; limits and network policy; capabilities).
- `core/queue.ts`: admission by job count, CPU and memory budget, priority, and host pressure.
- `core/providers/bwrap.ts`: the minimal local provider, bubblewrap with no daemon and no root.
- `server.ts`: `bb sandbox run` and `bb sandbox status`.
- `skills/sandbox/SKILL.md`: how agents use it.

It is not declared in any stack (`my.pkgs.bbPlugins`): try it with
`bb-plugins-sync --path <worktree>/assets/bb-plugins/sandbox` and point `bwrapPath` at a
bubblewrap binary (`bb plugin config sandbox set bwrapPath …`), since no host here installs one yet.

```sh
npm install && npm run typecheck && npm run lint && npm test
```

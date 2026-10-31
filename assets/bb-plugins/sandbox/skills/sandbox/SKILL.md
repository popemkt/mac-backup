---
name: sandbox
description: Run a command in an isolated, resource-capped sandbox with `bb sandbox run` (proof of concept, local bubblewrap provider), and read the queue with `bb sandbox status`. Use for untrusted or generated code, or to keep a heavy job under the machine's budget.
---

# Sandbox (proof of concept)

`bb sandbox run` creates a fresh sandbox, runs one command in it, prints its output and destroys
it. The sandbox sees an empty `/workspace` (its working directory), a private `/tmp` and home, and
the host's `/nix/store` and system tools read-only. It does not see `/home`, your checkout, `~/.ssh`
or bb's data, and with the default `--net none` it has no network.

```sh
bb sandbox run -- sh -c 'uname -a; id; ls /'
bb sandbox run --net open --timeout 120 -- sh -c 'curl -sI https://example.com | head -1'
bb sandbox run --cpus 4 --memory 4096 --priority 5 -- sh -c 'nproc'
bb sandbox status
```

- Options: `--net none|open` (default none), `--cpus N` (2), `--memory MiB` (2048), `--timeout S`
  (600, the sandbox's whole lifetime), `--priority N` (0; higher runs first). Everything after
  `--` is the command's argv, run without a shell unless you pass one.
- A run waits in a queue until it fits under the plugin's budget (4 sandboxes, 8 cores, 12 GiB by
  default) and while the host is not under CPU or memory pressure. Exit status is the command's.
- Isolation is Linux namespaces (shared kernel): good against accidents and semi-trusted code, not
  a boundary for hostile code. CPU, memory and process caps are only enforced when the `cgroups`
  setting is on, which needs the user's systemd manager; otherwise only the timeout is.
- There is no way to pass a file in or out yet: the command starts in an empty `/workspace`.

Settings: `bb plugin config sandbox set <key> <value>` with `bwrapPath`, `cgroups`, `maxJobs`,
`cpuBudget`, `memoryBudgetMiB` (budget changes apply after `bb plugin reload sandbox`).

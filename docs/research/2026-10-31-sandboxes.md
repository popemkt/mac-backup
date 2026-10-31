# Sandboxes for bulk agent work: OpenSandbox on shared-server, and a bb sandbox plugin

Date: 2026-10-31. This is research and design. A proof of concept of the plugin (the contract, the
queue and one local provider) is on the branch `bb/sandbox-plugin-poc`, which is not for merging.

Each claim carries a tag:

- **[measured]**: run on shared-server today.
- **[doc]**: vendor documentation or source, read today.
- **[secondary]**: a third-party write-up.
- **[unverified]**: not confirmed.

Nothing was installed system-wide, and nothing was restarted or rebuilt.

**The owner's ask.** "OpenSandbox on the shared server for this kind of work, or even a bb plugin
for our sandbox needs, just like the Upstash SDK, then we'll add providers: OpenSandbox local,
Upstash, or whatever."

**This kind of work** means bulk agent jobs. For example, many builders each work on one folder of
a repo, running untrusted or generated code, builds and headless browsers. Each builder is isolated
from the host and from the others. Jobs are queued, because shared-server is one box that has had
hardware resets.

## 1. Short answer

1. **Build the bb plugin first, with a local provider that needs no root, and add OpenSandbox
   second.**
   - The plugin owns the parts no provider has: one contract, an admission queue sized to this box,
     jobs that return a git branch, and a secrets and egress policy.
   - None of OpenSandbox, Upstash Box, E2B or Daytona queues work. Each has only a concurrency cap
     or a rate limit [doc]. So the queue has to be ours whichever provider runs the sandbox.
   - The first provider is **bubblewrap**: unprivileged user namespaces, no daemon, nothing to
     install.
   - The proof of concept runs it on shared-server today [measured, §8.7]. It has no network by
     default, no `/home`, and a timeout, and it is queued under a CPU and memory budget.
2. **OpenSandbox does fit shared-server, as phase 2, with conditions.**
   - It is the right project: `opensandbox-group/OpenSandbox`, formerly `alibaba/OpenSandbox`,
     Apache-2.0, now an AAIF project. Release 1.2.0 is from 2026-10-27 and it has about 16k stars
     [doc].
   - Its single-host Docker mode is the documented path. It gives what bubblewrap cannot:
     - container images;
     - per-sandbox egress allowlists (DNS plus nftables);
     - a credential vault that keeps secrets out of the sandbox;
     - preview URLs;
     - pause and snapshots;
     - gVisor (`runsc`) as a stronger runtime [doc].
   - The price is a Docker daemon on the host, which is root-equivalent. The server is not in
     nixpkgs, and the project is young (created December 2025, a release every one to two weeks).
   - Run it with gVisor as the runtime, on loopback only, inside a systemd slice with a hard CPU and
     memory ceiling (§9).
3. **Shape the contract after E2B and Upstash Box.** Their verbs line up closely (§5.4), and
   OpenSandbox's lifecycle and execd APIs map onto the same set.
4. **Order the hosted providers E2B first, then Upstash Box.**
   - **E2B** has Firecracker microVMs, per-second pricing, Apache-2.0 infrastructure you can host
     yourself later, `fork()` and header-injected secrets.
   - **Upstash Box** isolates with Docker in us-east-1 only and offers fixed sizes. It is cheap
     (active CPU only), and it has a built-in Claude Code or Codex agent run, git PR creation and
     header-injected secrets. That makes it the easiest hosted home for "one builder per box".
   - **Daytona's** open-source server is archived. Its development moved to a private codebase in
     June 2026 [doc], so it stays a later, SaaS-only option.
5. **Fan builders out in three steps, cheapest first.**
   - (a) **Code in the box:** the builder runs as an ordinary bb thread and runs the code it
     generates in a sandbox.
   - (b) **Agent in the box:** a *job* runs a headless agent CLI inside a sandbox on a git bundle of
     the repo and returns a branch.
   - (c) **Thread in the box:** a bb **machine provider** runs a whole bb thread in a sandbox.
   - Step (b) is the "many Sonnet builders, one folder each" case. It needs the model credential
     to stay out of the sandbox, which means injecting it at the egress (§8.6).

## 2. What the work needs

| Need | Why | Who provides it |
|---|---|---|
| Process, file and network isolation from the host and between jobs | Untrusted or generated code; builders must not see `~/.ssh`, bb's data or each other | provider |
| Resource caps per job, plus a host-wide ceiling | One box with 16 cores and 30 GB, shared by two people and every bb thread; it has had hardware resets | provider (per job), plugin queue and a systemd slice (ceiling) |
| A queue: concurrency, priorities, back-pressure | Bulk fan-out of N builders on a box that should never be asked for more than it has | **plugin** (no provider has one) |
| Workspace in, results out as a git branch or patch | Coordinator merges what builders produce | plugin (git bundle in, bundle or patch out) |
| Secrets only by explicit allowance; egress policy | A builder needs a model API and maybe a registry, nothing else | provider mechanism, plugin policy |
| Headless browsers, builds | Real workloads, not just `python -c` | provider runtime (namespaces or containers at native speed; gVisor is slower) |
| Survives restarts of bb and of the box | `app-bb` restarts on its own changes; the box resets | sandboxes outside bb's process tree; durable job rows reconciled at start |

## 3. shared-server today [measured]

- **System:** NixOS 26.11. The CPU is an AMD Ryzen 7 6800HS, 16 threads, with 30 GiB RAM (about 20
  GiB available at a load of about 2), 33 GiB of swap and 771 GB free disk.
- **KVM:** available. `/dev/kvm` is mode 0666 and `kvm_amd` is loaded, so microVMs (Firecracker,
  cloud-hypervisor, libkrun) are possible later.
- **cgroups:** v2 only. The root controllers are `cpuset cpu io memory hugetlb pids rdma misc dmem`,
  and `user.slice` delegates `cpu io memory pids`.
- **Unprivileged user namespaces work.** `unshare -Ur true` succeeds,
  `user.max_user_namespaces=125098`, and popemkt has `/etc/subuid` and `/etc/subgid` ranges
  (100000:65536) with `newuidmap` in `/run/wrappers`.
- **Container tooling:** none of Docker, Podman, runc, crun, runsc, firecracker, slirp4netns or
  pasta is installed. `bwrap` is not on PATH, but bubblewrap 0.12.0 is in the store, a dependency
  of an older system generation. The proof of concept used it through a GC root under thread
  storage. `systemd-nspawn`, `machinectl`, `systemd-run`, `prlimit` and `setpriv` are present.
- **Where bb runs code.**
  - Every agent thread runs in `app-bb-daemon.service` (`/proc/self/cgroup` is
    `0::/system.slice/app-bb-daemon.service`), a system unit run as popemkt. It has
    `Delegate=no`, no `MemoryMax` and no namespace restrictions.
  - A plugin's CLI and server code run in `app-bb.service`, which has the same properties.
  - **No user systemd manager runs for popemkt.** The account does not linger, so there is no
    `systemd-run --user` and no delegated cgroup for an agent to cap a child with.
- **Root is reachable anyway.** `security.sudo.wheelNeedsPassword = false` and both people are in
  `wheel` (`hosts/shared-server/default.nix`). So the sandbox is not there to stop an *agent* from
  becoming root. It is there to keep *untrusted code* away from the host, which means no setuid
  binaries in the sandbox (bubblewrap does not bind `/run/wrappers`, so there is no `sudo`), and to
  cap the blast radius of mistakes.
- **How the repo places things.**
  - A person's server app is a `my.services.<app>` entry (`modules/options/services.nix`), owned by
    a person and with an idleCheck when it runs others' work.
  - A capability is a stack under `modules/stacks/` that owns its options and contributes to
    channels such as `my.pkgs.bbPlugins` (CLAUDE.md, "Module Boundaries").
  - bb plugins live in `assets/bb-plugins/` and are installed by `bb-plugins-sync`.

## 4. OpenSandbox [doc unless marked]

- **Identity.**
  - The repository is `github.com/opensandbox-group/OpenSandbox`; the old `alibaba/OpenSandbox`
    URL redirects to it. It is now an [Agentic AI Foundation](https://aaif.io/projects/opensandbox)
    project, licensed Apache-2.0.
  - Release 1.2.0 was published 2026-10-27, after 1.1.1 (10-09) and 1.1.0 (09-21). The repo was
    created 2025-12-17 and has about 16.3k stars and 4.2k commits.
  - Security fixes go to the latest release and `main` only. Images are cosign-signed.
  - Package names still say Alibaba: npm `@alibaba-group/opensandbox`, PyPI `opensandbox` and
    `opensandbox-server`, Maven `com.alibaba.opensandbox`, plus a Go module and C#. There is also an
    `osb` CLI and an MCP server, `opensandbox-mcp`.
  - Other repos named OpenSandbox are forks or copies.
  - Don't confuse it with `kubernetes-sigs/agent-sandbox`, which OpenSandbox can use as one of its
    Kubernetes backends.
- **Architecture.**
  - The **lifecycle server** is a FastAPI service on `/v1`, port 8080 by default. It
    authenticates, validates and delegates to a runtime backend.
  - It stores only snapshot metadata and templates, in SQLite by default (PostgreSQL optional).
    The containers themselves are the truth.
  - Inside each sandbox, **`execd`** (staged from an OCI image before the entrypoint) serves
    commands (SSE streaming, background commands, sessions, a PTY over WebSocket), files,
    Jupyter-style code and metrics.
  - Clients talk to execd directly or through the server proxy `/sandboxes/{id}/proxy/{port}`.
  - An **egress sidecar** per sandbox enforces DNS and nftables policy and holds the **credential
    vault**.
  - Redis is optional (renew-on-access, pools).
- **Runtimes.**
  - **Docker** is the single-host path. The network mode is `host` by default, but egress policy
    needs `bridge`.
  - **Kubernetes** has its own `BatchSandbox` / `Pool` / `SandboxSnapshot` CRDs, or agent-sandbox.
  - **gVisor or Kata** is set per server with `[secure_runtime]` (`docker_runtime = "runsc"`).
  - **Firecracker** works only on Kubernetes, through the separate Fast Sandbox project.
  - **Podman** has no support statement, but merged fixes show real use: Podman detection, an
    egress readiness fix, and `pasta`/`slirp4netns` modes merged 2026-10-13. Rootless Podman
    end to end is **[unverified]**.
- **API.**
  - Auth is the `OPEN-SANDBOX-API-KEY` header. Without a key the server refuses to start unless
    you set `OPENSANDBOX_INSECURE_SERVER=YES`.
  - Lifecycle:
    - `POST /sandboxes` takes `image.uri`, `snapshotId` or `templateId`, plus `entrypoint`,
      `timeout`, `resourceLimits{cpu,memory,gpu}`, `env`, `metadata`, `networkPolicy` and
      `volumes`.
    - Then `GET`, `DELETE`, `pause`, `resume`, `renew-expiration`, `snapshots`, and
      `GET /sandboxes/{id}/endpoints/{port}` for preview URLs.
  - execd: `POST /command` (SSE), `/files/upload`, `/files/download`, `/files/search`, and so on.
- **Limits.**
  - `resourceLimits` sets CPU and memory. Docker adds `pids_limit` (4096 by default), dropped
    capabilities, `no_new_privileges` and seccomp.
  - `timeout` is an absolute expiry, capped by `max_sandbox_timeout_seconds`.
  - A per-sandbox disk quota is **[unverified]**.
- **Egress.** `networkPolicy{defaultAction, rules}` takes FQDN, wildcard, IP and CIDR rules, can be
  changed at runtime, and fails closed. `dns+nft` is needed to enforce IP and CIDR rules, and IPv6
  is disabled by default.
- **Pause and snapshots.** In Docker, pause freezes the container; the Kubernetes rootfs commit
  needs a registry. Snapshots work on Docker (local images).
- **Deployment.** `uvx opensandbox-server init-config ~/.sandbox.toml --example docker`, then
  `uvx opensandbox-server`. Or the `opensandbox/server` image with `/var/run/docker.sock` mounted
  (the upstream compose example). The config is TOML.
- **Caveats.**
  - The Docker socket is root.
  - Sandbox ports are published on `0.0.0.0` unless `[docker].publish_host` is set.
  - Each sandbox takes two or three host ports in 40000–60000.
  - A `pids_limit` below 4096 has broken threads ([#447](https://github.com/opensandbox-group/OpenSandbox/issues/447)).
  - execd may need `seccomp_profile=unconfined` on some hosts.
  - About 160 open issues and PRs.
  - Not in nixpkgs (no `pkgs/by-name/op/opensandbox`), and no NUR package was found.
- **Agent integrations.** There are repo examples for Claude Code, Codex, Gemini CLI, Playwright and
  Chrome. The MCP server exposes lifecycle, exec and text files only.

**Fit for shared-server.**

- **Yes:**
  - Single-host Docker is the documented mode.
  - `runsc` is in nixpkgs, and Docker's daemon settings can register it declaratively.
  - The server needs no database beyond SQLite.
  - It runs fine without KVM.
  - It brings egress allowlists and the credential vault, the two security pieces bubblewrap lacks.
- **Costs:**
  - a Docker daemon (dockerd and containerd), root-equivalent through its socket;
  - a sidecar container per sandbox that has an egress policy;
  - Python server packaging (use its OCI image);
  - fast-moving releases to pin and follow;
  - gVisor's syscall overhead on builds and Chromium (§6).
- **Verdict:** adopt in phase 2, behind the queue, with gVisor, loopback-only, inside a capped
  slice.

## 5. The "Upstash SDK", E2B and Daytona [doc]

### 5.1 Upstash Box: the SDK the owner means

[Upstash Box](https://upstash.com/docs/box/overall/quickstart.md) launched on 2026-03-09. It is a
persistent cloud container, "a computer for agents", with a built-in coding agent.

- **Packages:** `@upstash/box` (npm), `upstash-box` (PyPI) and `@upstash/box-cli`. The SDK is MIT.
  The service is SaaS only; self-hosting is **[unverified]** and not mentioned anywhere.
- **Isolation:** one Docker container per box. Upstash says itself that microVMs are a stronger
  boundary. Boxes cannot reach each other, private networks or cloud metadata. The only region is
  us-east-1.
- **Sizes:** small (2 vCPU, 4 GB, 10 GB), medium (4, 8, 20) or large (8, 16, 30). There are no
  per-resource knobs.
- **API:**
  - `Box.create({runtime, size, env, initCommand, networkPolicy, attachHeaders, git, browser, agent, timeout, keepAlive})`;
  - `Box.get`, `Box.list`;
  - `box.exec.command`, `exec.stream`, `exec.session`;
  - `box.files.read`, `write`, `upload`, `download`, `list`;
  - `box.getPublicURL(port, {bearerToken})`;
  - `pause`, `resume`, `snapshot`, `Box.fromSnapshot`, `delete`;
  - `EphemeralBox` (a TTL of up to 3 days; no agent, URLs or pause).
- **Egress:** `networkPolicy{mode: allow-all|deny-all|custom, allowedDomains, allowedCidrs}`,
  updated live.
- **Secrets:** `attachHeaders` injects headers host-side per HTTPS host, so a secret never enters
  the box. This is the model to copy.
- **Agent features:**
  - `box.agent.run({prompt, responseSchema, timeout, webhook})` with a Claude Code, Codex,
    OpenCode or Cursor harness.
  - `box.git.clone` and `box.git.createPR`.
  - Headless Chromium over CDP.
  - Cron schedules.
- **Pricing:** active CPU only, at $0.10, $0.20 or $0.40 per hour by size. Memory is free. The free
  tier allows 10 concurrent boxes; pay-as-you-go allows 1000 (soft).
- **No queue.**

### 5.2 E2B

- **Packages:** `e2b`, plus the code interpreter and desktop packages.
- **Licences:** the SDK and the [infra](https://github.com/e2b-dev/infra) are both Apache-2.0. The
  infra can be hosted yourself: a single-node "Embed" on KVM, or Terraform for GCP, AWS and Azure.
- **Isolation:** a Firecracker microVM per sandbox.
- **API:**
  - `Sandbox.create(template, {timeoutMs, envs, metadata, allowInternetAccess, network, lifecycle})`;
  - `commands.run(cmd, {background, onStdout, cwd, envs, timeoutMs})`, then `commands.connect(pid)`
    to reattach;
  - `files.read`, `write`, `list`, `watchDir`, plus signed upload URLs;
  - `getHost(port)`;
  - `pause()` (memory and disk) and `connect()` to resume;
  - `createSnapshot`, `fork({count})`, `kill`, `Sandbox.list`.
- **Resources:** CPU and RAM are fixed per template.
- **Egress:** `network{allowOut, denyOut, rules: {host: [{transform: {headers}}]}}`, where the
  header transform is E2B's secret injection.
- **Price:** $0.000014 per vCPU-second and $0.0000045 per GiB-second.
- **Limits:**
  - Hobby: 20 concurrent sandboxes, 1-hour runs, 1 creation per second.
  - Pro ($150/month): 100–1100 concurrent, 24-hour runs, 5 creations per second.
- **No queue:** the API returns 429 with `Retry-After`.

### 5.3 Daytona

- **Server status:** the server repo is **archived**. Development moved to a private codebase in
  June 2026. The last open release was AGPL-3.0 [secondary].
- **Packages:** `@daytona/sdk`.
- **Sandbox classes:** containers, or Linux VMs (VMs can pause and fork).
- **Create:** `create({image|snapshot, resources: {cpu, memory, disk}, envVars, secrets, networkAllowList | domainAllowList | networkBlockAll, autoStopInterval, ttlMinutes, queueTimeout})`.
- **API:**
  - `process.executeCommand` and sessions;
  - the `fs.*` methods;
  - `getPreviewLink(port)` and signed preview URLs;
  - `stop`, `start`, `pause`, `archive`, `fork`, `createSnapshot`, `delete`.
- **Secrets:** placeholders the proxy substitutes.
- **Price:** $0.0504 per vCPU-hour.
- **Queueing:** `queueTimeout` is the only queue-like feature, and it covers runner assignment only.

### 5.4 Verbs across SDKs

| Contract verb | Upstash Box | E2B | Daytona | OpenSandbox |
|---|---|---|---|---|
| create | `Box.create` | `Sandbox.create` | `daytona.create` | `POST /sandboxes` |
| get / list | `Box.get`, `Box.list` | `Sandbox.connect`, `Sandbox.list` | `get`, `list` | `GET /sandboxes[/{id}]` |
| exec | `exec.command`, `exec.stream` | `commands.run` | `process.executeCommand`, sessions | execd `POST /command` (SSE) |
| readFile / writeFile | `files.read`, `files.write` | `files.read`, `files.write` | `fs.downloadFile`, `fs.uploadFile` | execd `/files/download`, `/files/upload` |
| previewUrl | `getPublicURL` | `getHost` | `getPreviewLink` | `GET …/endpoints/{port}` |
| pause / resume | `pause`, `resume` | `pause`, `connect` | `pause`, `start` | `POST …/pause`, `…/resume` |
| snapshot | `snapshot` (disk) | `createSnapshot` (memory) | `createSnapshot` | `POST …/snapshots` |
| destroy | `delete` | `kill` | `delete` | `DELETE /sandboxes/{id}` |
| egress policy | `networkPolicy` | `network` | allowlists | `networkPolicy` |
| secret injection | `attachHeaders` | `network.rules…transform` | `secrets` | credential vault |
| limits | size tier | template | `resources` | `resourceLimits` |

Only one SDK offers each of these, so they stay outside the contract (each provider can expose its
own, §8.3):

- Upstash's built-in agent run and git PR;
- E2B's `fork` and `watchDir`;
- Daytona's live `resize`;
- OpenSandbox's Jupyter code contexts.

## 6. Other options

| Option | Isolation | Cold start | Cost | Self-host / licence | API | Egress control | Snapshot | NixOS |
|---|---|---|---|---|---|---|---|---|
| **bubblewrap** | namespaces (shared kernel), rootless | ~50 ms [measured] | free | LGPL | CLI | none or all | no | `pkgs.bubblewrap` |
| **systemd-run --user** | cgroups plus systemd sandboxing | ms | free | LGPL | CLI | `IPAddressDeny`/`Allow` [unverified] | no | built in; needs the user manager |
| **rootless Podman** | namespaces plus seccomp | ~1 s [unverified] | free | Apache-2.0 | CLI, REST | `--network none`, pasta | CRIU [unverified] | `virtualisation.podman` |
| **gVisor** (`runsc`) | user-space kernel | container-like | free | Apache-2.0 | OCI runtime | the runtime's | upstream checkpoint [unverified] | `pkgs.gvisor`; register with Docker; flaky under rootless Podman |
| **systemd-nspawn / `containers.<name>`** | namespaces, rootful | ~1 s [unverified] | free | systemd | `nixos-container`, Nix | `privateNetwork` plus NAT | no | built in; declarative, not per-job |
| **Firecracker** (raw, microvm.nix) | KVM microVM | ~125 ms [unverified] | free | Apache-2.0 | REST on a socket | yours (tap plus nft) | yes | `pkgs.firecracker`; microvm.nix |
| **Kata** | microVM per pod | [unverified] | free | Apache-2.0 | OCI, containerd | CNI | no | `kata-runtime` packaged; no module, fiddly |
| **microsandbox** | libkrun microVM | <100 ms claimed | free | Apache-2.0, beta | CLI, SDKs | host allowlist; secrets outside the VM | yes | not in nixpkgs (third-party flake) |
| **OpenSandbox** | container, or gVisor or Kata | [unverified] | free | Apache-2.0 | REST, 5 SDKs, MCP | DNS plus nft allowlist | Docker pause and snapshot | not packaged; OCI image |
| **E2B** | Firecracker | [unverified] | ~$0.05/h for 1 vCPU and 1 GiB | Apache-2.0 infra | SDK, REST | allow/deny plus header injection | memory pause, fork | hosted, or self-host Embed |
| **Upstash Box** | Docker | "instant" wake | $0.10–0.40/h of active CPU | SaaS | SDK, CLI | domain and CIDR policy plus `attachHeaders` | disk snapshot | hosted |
| **Daytona** | container or VM | <90 ms claimed | ~$0.07/h for 1 vCPU and 1 GiB | archived AGPL, now SaaS | SDK | allowlists plus secret placeholders | yes | hosted |
| **Modal Sandboxes** | gVisor (or a VM) | [unverified] | ~$0.14/core-h + $0.024/GiB-h [secondary] | SaaS | Python, JS, Go | CIDR and domain (SNI) allowlists | yes, memory experimental | hosted |
| **Vercel Sandbox** | Firecracker | [unverified] | $0.128/active-CPU-h | SaaS | TS, Python, CLI | [unverified] | yes | hosted |
| **Cloudflare Sandbox** | microVM per instance | [unverified] | $0.00002/vCPU-s | SaaS | Worker binding | off or on, credentials in Worker | beta | hosted; fractional vCPUs suit light jobs |
| **Docker Sandboxes** (`sbx`) | Docker's own microVM | "near-instant" | [unverified] | not stated | CLI | allow/deny | [unverified] | Ubuntu 24.04+ only; not NixOS |
| **k8s agent-sandbox** | gVisor or Kata via RuntimeClass | warm pools | free | Apache-2.0 | CRDs | NetworkPolicy | planned | needs Kubernetes; overkill here |

Notes that change the plan:

- **gVisor slows what we run most: builds (many syscalls) and Chromium.** Rootless Podman with
  `runsc` has a history of failures. So gVisor goes on the rootful Docker under OpenSandbox, not on
  the rootless path.
- **microVMs are the end state for hostile code, and KVM is ready here.** Firecracker has no image
  or egress story of its own, though, and microvm.nix is declarative but per-VM. Self-hosted E2B
  ("Embed", single node on KVM) or microsandbox are the realistic ways to get microVMs without
  building a platform. Both are phase 5 candidates, not first steps.
- **systemd-nspawn containers are declarative and long-lived, not per-job.** They do not suit
  per-job sandboxes.

## 7. Recommendation

| Order | Provider | Why first or next | Isolation |
|---|---|---|---|
| 1 | **`local-bwrap`** (built) with **systemd-run --user** scopes | Zero install. Proves the contract, queue, jobs and fan-out on the real box. Needs only linger and a slice for real caps (§9). | Namespaces; semi-trusted code |
| 2 | **`opensandbox`** on shared-server, Docker plus `runsc` | Images, egress allowlists, credential vault, preview URLs, snapshots; self-hosted, Apache-2.0 | gVisor; untrusted code |
| 3 | **`e2b`** (hosted) | microVMs, burst beyond the box, a self-host path later, `fork()` | Firecracker; hostile code |
| 4 | **`upstash-box`** (hosted) | The owner's reference; cheap; built-in agent run and PR | Docker |
| later | `daytona`, `modal`, self-hosted E2B or microsandbox on KVM | When a need appears | — |

**The default policy:**

- **Untrusted code:** OpenSandbox with gVisor, or E2B.
- **Builders working on our own repos** (semi-trusted; the risk is accidents and generated code,
  not attackers): `local-bwrap` with cgroup caps.
- **Every job:** `egress: none` unless the job names an allowlist.

## 8. The plugin: `assets/bb-plugins/sandbox`

### 8.1 Where code runs in bb, and why it matters

bb gives a plugin four places to run code:

- **CLI commands and server code** run in **`app-bb`**, the server. It restarts at once for its own
  changes.
- **`bb.host` entries** run in a lazy worker under **`app-bb-daemon`**, which stops after five idle
  minutes.
- **Agent tools** run in the server.
- **Machine and environment providers** are core-owned lifecycles with durable, idempotent create
  and remove.

A sandbox started as a child of either process dies with it. So:

- **Local sandboxes are not children of bb.**
  - The local provider starts each one as a transient user unit, `systemd-run --user --unit
    bb-sbx-<id> --slice bb-sandbox.slice …`. It lives in popemkt's user manager, survives
    `app-bb` and daemon restarts, and carries its own cgroup caps.
  - This needs linger for popemkt (§9).
  - The proof of concept still spawns `bwrap` from the server, with a `cgroups` setting that wraps
    each exec in `systemd-run --user --scope`.
- **Remote and hosted sandboxes** live in their provider. The plugin keeps only their ids.
- **State is durable.** The plugin's SQLite database (`bb.storage.database()`) holds sandboxes,
  jobs and leases. A `bb.background.service` reconciles them at start, and reconciliation is the
  answer to a hardware reset (§8.5).
- **Files given by path** go through `bb.sdk.files` with the invoking thread's `hostId`, never
  `node:fs` against the server's disk. This follows bb's multi-machine rule; the proof of concept
  is single-host.

### 8.2 The contract

[`core/contract.ts`](https://github.com/popemkt/.dotfiles/blob/bb/sandbox-plugin-poc/assets/bb-plugins/sandbox/core/contract.ts)
on the proof-of-concept branch holds the provider half. The full contract adds files in and out,
ports, secrets and the job layer:

```ts
type NetworkPolicy =
  | { egress: "none" }                                   // default
  | { egress: "allowlist"; hosts: string[] }             // "api.anthropic.com", "*.npmjs.org:443"
  | { egress: "open" };

interface Limits { cpus: number; memoryMiB: number; pids: number; timeoutSec: number; diskMiB?: number }

interface SandboxSpec {
  image?: string;                         // provider image/template; local: host /nix/store, read-only
  limits: Limits;
  network: NetworkPolicy;
  env?: Record<string, string>;           // never secrets
  secrets?: string[];                     // names from the plugin's secret allowlist (§8.6)
  ports?: number[];
  labels?: Record<string, string>;        // threadId, jobId, batch
}

interface Capabilities {
  isolation: "namespaces" | "gvisor" | "microvm";
  enforces: Array<keyof Limits>;          // the rest are advisory, and reported as such
  egress: Array<NetworkPolicy["egress"]>;
  secretInjection: "header" | "none";     // header = the secret stays outside the sandbox
  ports: boolean; pause: boolean; snapshot: boolean;
}

interface SandboxProvider {
  id: string; capabilities: Capabilities;
  create(spec, signal?): Promise<SandboxInfo>;
  exec(id, { argv, cwd?, env?, timeoutSec?, stdin? }, { signal?, onOutput? }): Promise<ExecResult>;
  readFile(id, path): Promise<Uint8Array>;
  writeFile(id, path, data): Promise<void>;
  upload(id, tarball: Uint8Array, dest): Promise<void>;     // a whole tree in one call
  download(id, path): Promise<Uint8Array>;                  // tar of a path
  list(labels?): Promise<SandboxInfo[]>;
  previewUrl?(id, port): Promise<{ url: string; headers?: Record<string, string> }>;
  pause?(id); resume?(id); snapshot?(id): Promise<{ snapshotId: string }>;
  destroy(id): Promise<void>;
  extension?<T>(name: string): T | undefined;               // provider-only verbs (§5.4), opt-in
}
```

The contract follows three rules:

- **A capability never fails silently.** `create` refuses what a provider cannot enforce (an
  allowlist on `local-bwrap`, ports, secrets) with `SandboxUnsupported`. It does not quietly run
  with less.
- **Limits are always requested; `enforces` says which ones hold.** The queue budgets the requested
  limits either way.
- **`argv`, never a shell string.** A caller who wants a shell passes `["sh", "-c", …]`.

The job layer sits above providers and is the unit the queue schedules:

```ts
interface JobSpec {
  provider?: string;                    // default: the plugin setting
  sandbox: SandboxSpec;
  priority: number;                     // higher first; FIFO within a priority
  workspace?: { repo: string; ref: string; subdir?: string };   // sent in as a git bundle
  steps: Array<{ run: string[] } | { agent: { cli: "claude" | "opencode" | "codex"; promptFile: string } }>;
  collect?: { kind: "bundle" | "patch"; paths?: string[] };      // results out
  retry?: { max: number };              // re-run from scratch when the box or provider lost it
  labels?: Record<string, string>;      // batch=…, parentThread=…
}
// Job state: queued → provisioning → running → collecting → done | failed | cancelled
```

### 8.3 Providers

| Provider | Phase | Transport | Notes |
|---|---|---|---|
| `local-bwrap` | 1 (proof of concept built) | `systemd-run --user` + `bwrap` | `/workspace` is a host directory; `/nix/store` read-only. An optional `nix: true` binds the nix-daemon socket so jobs can `nix shell` toolchains: the daemon builds sandboxed as `nixbld`, but this widens the surface. Egress is `none` or `open` only; no secrets. |
| `opensandbox` | 2 | REST to `127.0.0.1:<port>` with the API key from a 0600 file; the TS SDK `@alibaba-group/opensandbox` or plain `fetch` | Network and secrets go through `networkPolicy` and the credential vault. Ports go through endpoints with `use_server_proxy`. |
| `e2b` | 3 | `e2b` SDK, API key as a plugin secret setting | Templates set the size. `limits` choose the template; the rest are advisory. |
| `upstash-box` | 4 | `@upstash/box` | Limits round up to the next size tier. Extensions: `agent.run`, `git.createPR`. |

### 8.4 How agents use it

**CLI** (one `bb sandbox` command, `defineCli`, `--json` everywhere, output bounded under bb's 1 MiB
CLI cap):

```text
bb sandbox providers                                    # ids, capabilities, readiness
bb sandbox run    [limits] [--net none|open|allow:h1,h2] [--provider p] -- <argv…>   # one-shot (built)
bb sandbox create [limits] [--image i] [--label k=v] [--ttl S]          → id
bb sandbox exec   <id> [--cwd d] [--timeout S] -- <argv…>
bb sandbox put    <id> <local-path> <sandbox-path>     # through bb.sdk.files on the caller's host
bb sandbox get    <id> <sandbox-path> <local-path>
bb sandbox url    <id> <port>
bb sandbox pause|resume|snapshot|rm <id>
bb sandbox ls     [--label k=v]
bb sandbox job submit [JobSpec flags | --spec file.json]   → job id
bb sandbox job ls|wait|logs|cancel [<id>|--label batch=…]
bb sandbox job result <id> [--as-branch <name>]           # fetch the bundle into the caller's repo
bb sandbox status                                         # queue: running, waiting, budget used (built)
```

**Agent tools.** There are only three, so they stay cheap in every session:

- `sandbox_run`: one-shot exec.
- `sandbox_job_submit`.
- `sandbox_job_wait`: returns the result summary and the branch name.

Everything else is reached through the CLI and the plugin's skill.

`bb.agents.contributeInstructions` adds one line only when the person enables "prefer sandboxes" for
a project: run generated code with `bb sandbox run`.

**Fan-out of builders**, steps (a) and (b) from §1:

```sh
# Coordinator thread, in the repo checkout:
batch=refactor-$(date +%s)
for dir in packages/*/; do
  name=$(basename "$dir")
  bb sandbox job submit --label batch=$batch --priority 1 \
    --repo . --ref HEAD --subdir "$dir" \
    --cpus 2 --memory 3072 --timeout 3600 --net allow:api.anthropic.com,registry.npmjs.org \
    --secret anthropic \
    --agent claude --prompt-file "plans/$name.md" \
    --collect bundle
done
bb sandbox job wait --label batch=$batch            # blocks; prints per-job status
for id in $(bb sandbox job ls --label batch=$batch --state done --json | jq -r '.[].id'); do
  bb sandbox job result "$id" --as-branch "sandbox/$batch/$id"
done
# Review each branch; merge or open PRs from the host, which holds the git credentials.
```

How a job runs:

1. The plugin makes a `git bundle` of `ref` on the invoking host and uploads it.
2. It clones the bundle into `/workspace` inside the sandbox, so the sandbox needs no GitHub access.
3. It runs the steps. An `agent` step runs `claude -p` (or `opencode run`) headless, with the
   prompt file and `--max-turns`, in `subdir`.
4. It commits whatever changed.
5. It runs `git bundle create out.bundle <base>..HEAD` and downloads the result.
6. `job result` runs `git fetch <bundle> HEAD:refs/heads/<branch>` in the caller's checkout.

Only the host ever pushes.

**Step (c), a whole bb thread in a sandbox.**

- A `bb.experimental_machines` provider with `ephemeral: true`. Its `MachineExecutor.exec` is the
  contract's `exec`, so `bb.experimental_machines.bootstrap` can install and enroll a bb daemon in
  the sandbox.
- An environment composition then offers "New sandbox" in the thread picker, and bb removes the
  machine when no live thread needs it.
- This gives each builder a full, visible bb thread. It needs Node, npm and curl in the image, and
  egress to the bb server and the model API.
- Core sets up the project's git remote on a new machine, so the sandbox would need git
  credentials. It conflicts with "only the host pushes" until bb can seed a project from a bundle.
  That is an open question (§11).

### 8.5 The queue (built in the proof of concept: `core/queue.ts`)

**Admission.** A job is admitted when all of these hold:

- running jobs < `maxJobs`;
- the CPU and memory budget is not exceeded (the sum of running jobs' requested limits);
- the host is not under pressure.

**Pressure** is read from `/proc/pressure/cpu` and `/proc/pressure/memory` (PSI "some" avg10 over
60 % or 10 %). Pressure only holds new admissions; running jobs are never touched.

**Ordering.** Priority first, then first-in first-out. The head of the queue is never overtaken by
a smaller job, so a big high-priority job cannot starve. A job larger than the whole budget is
refused at submit.

**Budgets.** There is one budget per provider. The local budget defaults to 4 jobs, 8 cores and
12 GiB, about half the box, leaving room for the two people's threads, kb and T3. Hosted
providers default to their plan's concurrency.

**Persistence (phase 1 adds it; the proof of concept keeps the queue in memory).**

- Jobs are rows in the plugin's SQLite.
- On load, the reconciler compares rows with `provider.list()`:
  - a `running` job whose sandbox is gone becomes `failed: lost`, and is retried if `retry.max`
    allows;
  - a sandbox with no job is destroyed;
  - a `queued` job stays queued.
- That covers an `app-bb` restart, a daemon restart and a hardware reset alike. `systemd-run` units
  do not survive a reboot, and OpenSandbox containers with no restart policy do not either.

### 8.6 Security

- **No secret enters a sandbox by default.**
  - The host's environment is never inherited: `--clearenv` locally, an explicit `env` remotely.
  - The sandbox sees no `$HOME`, `~/.ssh`, SSH agent, git credentials, bb token or `~/.bb`.
  - Proven in the proof of concept: `/` holds only `dev home nix proc run tmp workspace`, and
    `/home` holds only the sandbox's own home [measured].
- **Named secrets only, injected at the egress where possible.**
  - Secrets are plugin secret settings (0600, server-side) plus a policy that lists, for each
    secret, the hosts it may be sent to.
  - A job asks for `--secret anthropic`. The plugin passes it as a header rule for its allowed hosts
    (Upstash `attachHeaders`, E2B `network.rules…transform`, the OpenSandbox credential vault, a
    Daytona secret placeholder), so the value never exists inside the sandbox.
  - A provider whose `secretInjection` is `none` (`local-bwrap`) refuses secrets.
  - Passing a secret as an environment variable is a separate, explicit per-secret flag
    (`exposeAsEnv`). It is off by default and logged on every job.
- **Model credentials for agent steps.**
  - Agent steps need a key in the request header, which header injection covers for an API key
    (`x-api-key` for api.anthropic.com).
  - A Claude subscription (OAuth) token is a bearer header too, but it belongs to a person's
    account. Putting it behind a proxy for bulk use may conflict with the provider's terms. See
    §11.
- **Egress.**
  - The default is `none`.
  - Allowlists need `opensandbox` (DNS plus nftables), a hosted provider, or a later local egress
    proxy.
  - `local-bwrap` offers only `none` and `open`, and `open` is opt-in for each run.
  - Private ranges and the tailnet are never in an allowlist.
  - bb's own server URL is allowlisted only for step (c).
- **Resource caps that protect the box.** There are five layers, outermost first:
  1. The queue budget and PSI gate (the plugin).
  2. A hard ceiling on the `bb-sandbox.slice` user slice: `MemoryMax`, `CPUQuota`, `TasksMax`,
     `IOWeight`. For OpenSandbox, the same on `docker.service`'s slice, or a dedicated
     `sandbox.slice` for containerd shims (§9).
  3. Per-sandbox cgroup limits.
  4. `nice 19` and idle I/O priority.
  5. TTL on every sandbox.

  `MemorySwapMax=0` on sandboxes keeps a runaway job from pushing the host into swap. That matters
  more than usual on a box whose resets correlate with load spikes on the dGPU path.
- **Ports.**
  - Preview URLs are bound to loopback. OpenSandbox gets `publish_host = "127.0.0.1"`; its default
    is `0.0.0.0`.
  - A port is reached from a Mac through bb's shared-port tunnel (`bb.hosts.declareSharedPorts`) or
    `adhoc-popemkt`. It is never published on the tailnet by default.
- **Paths.** Host-side file verbs refuse `..` and any symlink the sandbox planted. The proof of
  concept tests this, and nothing runs inside a sandbox between execs, so there is no race.
- **Isolation honesty.**
  - `local-bwrap` shares the host kernel. It is a seatbelt, not a vault.
  - Hostile code (untrusted third-party repos, scraping arbitrary sites) goes to `opensandbox` with
    gVisor or to E2B.
  - Each provider states its class in `capabilities.isolation`, and a job can demand a minimum,
    `--isolation gvisor`.

### 8.7 The proof of concept [measured]

- **Branch:** `bb/sandbox-plugin-poc`, `assets/bb-plugins/sandbox`.
- **Contents:**
  - `core/contract.ts`;
  - `core/queue.ts`;
  - `core/providers/bwrap.ts`;
  - `server.ts`, which provides `bb sandbox run` and `bb sandbox status`;
  - a skill;
  - 10 tests (queue admission, budget, priority, pressure, cancellation, bwrap flags, refusals,
    path and symlink escapes).
- **Checks:** typecheck, oxlint and tests pass.
- **Install:** with `bb-plugins-sync --path`. `bwrapPath` points at the store's bubblewrap.
- **Results on shared-server:**
  - `bb sandbox run -- sh -c '…'`: hostname `sandbox`, `/` = `dev home nix proc run tmp workspace`,
    no `~/.ssh`, cwd `/workspace`, curl fails with no network. Took 49 ms.
  - `--timeout 2 -- sleep 30` is killed at about 2 s with exit 137.
  - `--net open` gets `200` from `https://example.com`.
  - `--cpus 99` is refused: "the budget is 8 CPU".
  - Six concurrent runs with `maxJobs` 4 show `running: 4, waiting: 2`, and all six then complete.
- **Not in it:**
  - cgroup caps (the `cgroups` setting exists, but no user manager runs here);
  - jobs, persistence and other providers;
  - a declaration in any stack.

## 9. NixOS deployment sketch

**A new stack, `sandboxes`**, in `modules/stacks/sandboxes/` (`default.nix` for the shared schema,
`nixos.nix` for the Linux side), imported from `modules/stacks/default.nix` and
`modules/stacks/nixos.nix`.

It is its own stack because it is a vertical slice: the bb plugin, the host runtime, the user
manager and the OpenSandbox server are one capability. The plugin is only one client; `osb`, the
MCP server and the Macs could be others. Folding it into `bb` would make bb own Docker. The
`ai-agents` stack is still macOS-only.

The OpenSandbox server is host infrastructure that talks to the root Docker socket, not a person's
app. So it is a plain system unit owned by the stack, not a `my.services` entry, whose schema is
"an app run as its owner".

```nix
# hosts/shared-server/default.nix
my.stacks.sandboxes = {
  enable = true;                 # the plugin (my.pkgs.bbPlugins) and bubblewrap on PATH
  local = {
    enable = true;               # rootless provider: linger plus a capped user slice per person
    people = [ "popemkt" ];
    ceiling = { cpus = 8; memory = "12G"; tasks = 4096; };   # the slice's hard limits
  };
  opensandbox = {
    enable = false;              # phase 2
    port = 8090;                 # loopback only
    runtime = "runsc";           # "runc" | "runsc"
    maxSandboxTimeout = 7200;
    ceiling = { cpus = 8; memory = "12G"; };
    image = "ghcr.io/opensandbox-group/opensandbox/server@sha256:…";   # pinned by digest
  };
};
```

```nix
# modules/stacks/sandboxes/nixos.nix (shape, not final)
{ config, lib, pkgs, ... }:
let cfg = config.my.stacks.sandboxes; in
lib.mkIf cfg.enable (lib.mkMerge [
  {
    my.pkgs.bbPlugins = [ "assets/bb-plugins/sandbox" ];
    environment.systemPackages = [ pkgs.bubblewrap ];
  }
  (lib.mkIf cfg.local.enable {
    # A user manager for each person, so a sandbox is a transient user unit that outlives
    # app-bb and app-bb-daemon and carries its own cgroup caps.
    users.users = lib.genAttrs cfg.local.people (_: { linger = true; });
    # The ceiling every local sandbox runs under.
    systemd.user.slices.bb-sandbox.sliceConfig = {
      CPUQuota = "${toString (cfg.local.ceiling.cpus * 100)}%";
      MemoryMax = cfg.local.ceiling.memory;
      MemorySwapMax = "0";
      TasksMax = cfg.local.ceiling.tasks;
      IOWeight = 10;
    };
  })
  (lib.mkIf cfg.opensandbox.enable {
    virtualisation.docker = {
      enable = true;
      daemon.settings.runtimes.runsc.path = "${pkgs.gvisor}/bin/runsc";
    };
    # dockerd, containerd and every container shim under one capped slice.
    systemd.slices.sandbox.sliceConfig = { CPUQuota = "…"; MemoryMax = "…"; };
    systemd.services.docker.serviceConfig.Slice = "sandbox.slice";
    # The server: the upstream image with the Docker socket, config generated from the options
    # (pkgs.formats.toml): [server] api_key_file, [docker] publish_host = "127.0.0.1",
    # network_mode = "bridge", [secure_runtime] docker_runtime = cfg.opensandbox.runtime,
    # [egress] mode = "dns+nft", max_sandbox_timeout_seconds.
    virtualisation.oci-containers.containers.opensandbox = { /* image, ports 127.0.0.1:port, volumes */ };
    # The API key is machine state (scripts/shared-server-secrets), never declared.
  })
]);
```

- **Keep these out of the declaration:**
  - Nobody joins the `docker` group. Only the OpenSandbox container gets the socket, and both
    people have sudo anyway.
  - No tailnet Service for OpenSandbox until the Macs need it. When they do, add
    `my.stacks.vpn.services.opensandbox`, its grant and its auto-approver.
- **Load.** Linger starts one `systemd --user` per listed person, a few MB each. Docker and
  containerd idle at roughly 100 MB [unverified]. Neither restarts `app-bb` or `app-bb-daemon`.
- **Rebuild.**
  - Run it through `rebuild`, detached, per CLAUDE.md, by a person.
  - Linger and the user slice take effect without a reboot.
  - The `docker` unit starts fresh, so there is no restart of anything existing.

## 10. Phased plan

| Phase | Delivers | Needs root? | Done when |
|---|---|---|---|
| 0 | This doc; proof of concept on `bb/sandbox-plugin-poc` | no | ✅ |
| 1 | The plugin for real: `defineCli`; durable jobs in SQLite; the reconciler; `local-bwrap` through `systemd-run --user`; `put`/`get` through `bb.sdk.files`; the jobs' git bundle in and out; the three agent tools; the `sandboxes` stack with `local` (linger, slice, bubblewrap), declared for shared-server | yes, the stack (a rebuild) | A coordinator fans out 4 shell-step jobs on folders of a repo and gets 4 branches back, with the slice ceiling verified under a stress job |
| 2 | `opensandbox` provider; `opensandbox` component (Docker, runsc, loopback server, capped slice); egress allowlists; named secrets through the credential vault | yes | A job with `--isolation gvisor --net allow:registry.npmjs.org` builds a package. A secret reaches its allowed host only, and `env` inside shows no value. |
| 3 | `agent` steps (headless `claude -p` / `opencode run`) with model-key header injection; `job wait` summaries; a fan-out skill for coordinators | no | N Sonnet builders, one folder each, return reviewed branches |
| 4 | `e2b` and `upstash-box` providers (secret settings, size mapping, extensions); per-provider budgets; overflow from local to hosted when the local queue is long | no | The same batch runs unchanged with `--provider e2b` |
| 5 | Step (c): the sandbox machine provider (a bb thread inside a sandbox); a microVM local provider (self-hosted E2B Embed or microsandbox on KVM) if gVisor proves too slow | maybe | A builder thread visible in bb runs wholly in a sandbox |

## 11. Questions for the owner

1. **Model credentials for agent steps (phase 3).**
   - Should in-sandbox builders use an **Anthropic API key**, injected as a header so the sandbox
     never sees it, or a person's **Claude subscription**?
   - Or should builders stay outside sandboxes, as bb threads that only *run code* in them
     (step (a))? That needs no credential at all.
2. **OpenSandbox's cost.** Is a rootful Docker daemon on shared-server acceptable (phase 2)? The
   alternative for untrusted code is a hosted microVM provider (E2B) and no Docker on the box.
3. **Hosted providers and spending.** Which accounts exist or should exist (E2B, Upstash), and what
   cap per month? The plugin can enforce a per-provider budget in sandbox-hours.
4. **Linger.** May popemkt (and bytetum?) get a lingering user manager? It is the clean way to get
   cgroup caps and sandboxes that survive bb restarts. Alternatively, a small root-owned "sandbox
   broker" unit could start transient system units on request, which is more code and more
   privilege.
5. **Thread-in-sandbox (step (c)).** Is a fully visible bb thread per builder worth phase 5? It
   needs git credentials in the sandbox, or a bb change to seed a project from a bundle.
6. **Budget.** Is half the box (8 cores, 12 GiB, 4 concurrent sandboxes) the right ceiling for
   sandboxes on shared-server, given bytetum's use of it?

## Sources

- **OpenSandbox:**
  - [repository](https://github.com/opensandbox-group/OpenSandbox), [architecture](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/docs/architecture/index.md), [server configuration](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/server/configuration.md);
  - [lifecycle API](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/specs/sandbox-lifecycle.yml), [execd API](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/specs/execd-api.yaml), [egress](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/docs/architecture/network/egress.md);
  - [secure runtime](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/docs/guides/secure-container.md), [pause/resume](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/docs/guides/pause-resume.md), [roadmap](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/ROADMAP.md);
  - [compose example](https://raw.githubusercontent.com/opensandbox-group/OpenSandbox/main/server/docker-compose.example.yaml), [releases](https://api.github.com/repositories/1118085970/releases);
  - Podman: [#1801](https://github.com/opensandbox-group/OpenSandbox/issues/1801), [#1806](https://github.com/opensandbox-group/OpenSandbox/pull/1806), [#2203](https://github.com/opensandbox-group/OpenSandbox/pull/2203).
- **Upstash Box:**
  - [launch](https://upstash.com/blog/upstash-box), [how it works](https://upstash.com/docs/box/overall/how-it-works.md), [files](https://upstash.com/docs/box/overall/files.md), [shell](https://upstash.com/docs/box/overall/shell.md), [preview](https://upstash.com/docs/box/overall/preview.md);
  - [snapshots](https://upstash.com/docs/box/overall/snapshots.md), [network policy](https://upstash.com/docs/box/overall/network-policy.md), [attach headers](https://upstash.com/docs/box/overall/attach-headers.md), [agent](https://upstash.com/docs/box/overall/agent.md), [pricing](https://upstash.com/docs/box/overall/pricing.md);
  - [SDK](https://github.com/upstash/box).
- **E2B:**
  - [docs](https://docs.e2b.dev/), [infra](https://github.com/e2b-dev/infra);
  - [persistence](https://docs.e2b.dev/sandbox/persistence.md), [fork](https://docs.e2b.dev/sandbox/fork.md), [internet access](https://docs.e2b.dev/network/internet-access.md), [billing](https://docs.e2b.dev/billing.md).
- **Daytona:**
  - [sandboxes](https://www.daytona.io/docs/en/sandboxes.md), [TS SDK](https://www.daytona.io/docs/en/typescript-sdk/sandbox.md), [network limits](https://www.daytona.io/docs/en/network-limits.md), [limits](https://www.daytona.io/docs/en/limits.md), [pricing](https://www.daytona.io/pricing).
- **Others:**
  - [Modal networking](https://modal.com/docs/guide/sandbox-networking), [Vercel Sandbox pricing](https://vercel.com/docs/vercel-sandbox/pricing), [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/), [microsandbox](https://github.com/superradcompany/microsandbox);
  - [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md), [microvm.nix](https://github.com/microvm-nix/microvm.nix), [gVisor + Docker](https://gvisor.dev/docs/user_guide/quick_start/docker/), [gVisor rootless issue](https://github.com/google/gvisor/issues/311);
  - [NixOS containers](https://wiki.nixos.org/wiki/NixOS_Containers), [Docker Sandboxes](https://www.docker.com/blog/why-microvms-the-architecture-behind-docker-sandboxes/), [k8s agent-sandbox](https://agent-sandbox.sigs.k8s.io/docs/getting_started/overview/).
- **bb:**
  - the `bb-plugin-authoring` skill references for bb 0.46.1 / SDK 0.6.49: CLI and agent tools, host entries and their 5-minute idle worker, background services, storage, machine providers and `MachineExecutor`, environment providers.

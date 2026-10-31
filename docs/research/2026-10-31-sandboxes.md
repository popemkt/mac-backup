# Sandboxes for bulk agent work: OpenSandbox on shared-server, and a bb sandbox plugin

Date: 2026-10-31. This is research and design. A proof of concept of the plugin (the contract, the
queue and one local provider) is on the branch `bb/sandbox-plugin-poc`, which is not for merging.

**Updated the same day with the owner's decisions** (§8). They change §9 onward: §9 is now the
SDK, the operation table and the contract; §10 is the AgentSpec; §12 is Blender; §13 is the real
`sandboxes` stack. §1–§7 are the original findings.

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
   - The proof of concept runs it on shared-server today [measured, §9.7]. It has no network by
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
     memory ceiling (§13).
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
     to stay out of the sandbox, which means injecting it at the egress (§11).

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
own, §9.5):

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
| 1 | **`local-bwrap`** (built) with **systemd-run --user** scopes | Zero install. Proves the contract, queue, jobs and fan-out on the real box. Needs only linger and a slice for real caps (§13). | Namespaces; semi-trusted code |
| 2 | **`opensandbox`** on shared-server, Docker plus `runsc` | Images, egress allowlists, credential vault, preview URLs, snapshots; self-hosted, Apache-2.0 | gVisor; untrusted code |
| 3 | **`e2b`** (hosted) | microVMs, burst beyond the box, a self-host path later, `fork()` | Firecracker; hostile code |
| 4 | **`upstash-box`** (hosted) | The owner's reference; cheap; built-in agent run and PR | Docker |
| later | `daytona`, `modal`, self-hosted E2B or microsandbox on KVM | When a need appears | — |

**The default policy:**

- **Untrusted code:** OpenSandbox with gVisor, or E2B.
- **Builders working on our own repos** (semi-trusted; the risk is accidents and generated code,
  not attackers): `local-bwrap` with cgroup caps.
- **Every job:** `egress: none` unless the job names an allowlist.

## 8. Decisions (owner, 2026-10-31)

These close §11 of the first version of this doc. The owner did not object to the defaults, so
the build uses them.

| # | Question | Decision |
|---|---|---|
| — | The interface | A typed SDK in the spirit of Upstash Box: `Sandbox.create({ provider, image \| workspace, resources, network, storage, env, timeout })`, then `exec`, `files.*`, `ports`, `snapshot()`, `destroy()`, and bulk `createMany()`. A CLI and agent tools mirror it one-to-one. Switching backends changes one field. |
| — | The queue | The plugin owns it. |
| — | An agent spec | A declarative **AgentSpec** describes one run completely (§10). Specs are versioned files fanned out in bulk; results land as branches. |
| — | Blender | Blender on shared-server, with the best headless MCP server (§12), usable on the host and as a sandbox image. |
| 1 | Model credentials | **Builders stay outside sandboxes for now** (step (a) of §1). The design keeps API-key injection at the boundary for step (b). |
| 2 | Docker | **No Docker daemon yet.** bubblewrap first; OpenSandbox later. |
| 3 | Hosted accounts | **None yet.** The E2B and Upstash provider slots stay in the design. |
| 4 | Linger | **Yes, for popemkt only**, so cgroup caps work. |
| 5 | Thread in a sandbox (step (c)) | **Later.** |
| 6 | Budget | **8 cores, 12 GiB, 3 concurrent sandboxes** while the host has resets. |

## 9. The plugin: `assets/bb-plugins/sandbox`

### 9.1 One contract, every implementation

The concept is *a sandbox*. Its promise lives in one place, the provider contract
(`core/contract.ts`), and **one contract suite** (`tests/contract.test.ts`) runs over every entry
of `PROVIDERS`. A new provider joins the suite and goes green or red there, never in a test of its
own. This follows kb's [One contract, every implementation](https://github.com/popemkt/kb/blob/v0.3.0/AGENTS.md#one-contract-every-implementation).

The *operations* on sandboxes (create, exec, files, …) also live in one place: an **operation
table** (`core/ops.ts`). Each entry has a name, a summary, a zod input schema, the CLI positionals
and a handler. Three surfaces are generated from that table, so they cannot drift:

| Surface | How it is generated | Example |
|---|---|---|
| CLI | one `bb sandbox <op>` command per entry (`defineCli`). Scalar fields become flags; any field can also come from `--input <json \| @file>`. | `bb sandbox exec sbx1a2b -- npm test` |
| Agent tools | one tool per entry, `sandbox_<op>`, with the entry's schema | `sandbox_exec({ id, argv })` |
| SDK | a `call(op, input)` transport plus typed wrappers; a parity test fails if an op has no wrapper | `await sb.exec(["npm", "test"])` |

The agent tools are offered only to threads that use sandboxes: builder threads the AgentSpec
runner starts (plugin metadata `sandbox`), or every thread when the `toolsForAllThreads` setting
is on. Everyone else uses the CLI, which the plugin's skill documents.

### 9.2 Where it runs

| Piece | Runs in | Why |
|---|---|---|
| Ops, queue, AgentSpec runner | the bb server (`app-bb`), plugin code | One admission authority. State lives in `bb.storage.kv`, so it survives restarts. |
| Local sandboxes (bubblewrap) | popemkt's **user manager** (`systemd-run --user --scope --slice=sandbox.slice`) | They leave bb's process tree, so neither bb unit owns them, and they get cgroup caps. Needs linger (§13). |
| SDK clients | anywhere: a script, another plugin, an agent's code | They reach the ops over the plugin's HTTP route `POST /api/v1/plugins/sandbox/http/op` (`auth: "token"`; the token comes from `BB_SANDBOX_TOKEN` or `bb plugin token sandbox`). |

A sandbox's processes live only for one `exec` call. The provider kills the exec's process group
when it returns or times out, and execs in one sandbox run one at a time, so a sandbox's limits
hold for the whole sandbox. Only its files persist between execs. Background servers, and with
them `ports`, need a provider whose sandboxes run continuously (OpenSandbox, E2B, Upstash).

### 9.3 The SDK

```ts
import { Sandbox } from "/etc/bb-sandbox/plugin/sdk/index.ts";   // the stack installs it there (§13)

const sb = await Sandbox.create({
  provider: "bwrap",                          // one field switches backends; default from the host policy
  image: { nix: ["nodejs_22", "git"] },       // or { preset: "blender" }, or { oci: "node:22" } where supported
  workspace: { git: { repo: "/home/popemkt/code/vn-monuments", ref: "main" } },
  resources: { cpus: 2, memoryMiB: 3072, pids: 512 },
  network: { egress: "none" },                // "open", or { egress: "allowlist", hosts } where supported
  storage: { volumes: [{ name: "npm-cache", mount: "/cache/npm" }] },
  env: { NODE_ENV: "test" },
  timeoutSec: 1800,
  labels: { batch: "monuments-1" },
  priority: 1,
});
const r = await sb.exec(["npm", "test"], { cwd: "/workspace", timeoutSec: 600 });
await sb.files.write("/workspace/notes.md", "…");
const text = await sb.files.read("/workspace/out/report.json");
const snap = await sb.snapshot();             // later: Sandbox.create({ ..., workspace: { snapshot: snap.snapshotId } })
const url = await sb.ports.url(3000);         // throws SandboxUnsupported on bwrap
await sb.destroy();

// Bulk: returns at once with queued handles; each method waits until its sandbox is admitted.
const boxes = await Sandbox.createMany(folders.map((f) => ({ ...base, labels: { folder: f } })));
```

The verbs and their names follow §5.4: `create`, `createMany`, `get`, `list`, `exec`,
`files.{read,write,list}`, `ports.url`, `snapshot`, `pause`, `resume`, `destroy`, plus
`queue.status` and `providers.list`. Files are bytes, base64 over the wire, at most 8 MiB per
call. A large tree goes in as a workspace, not file by file.

### 9.4 The contract

The spec types are zod schemas in `core/spec.ts`, the one home of the shape; TypeScript types are
inferred from them.

```ts
type Image = { nix: string[] } | { preset: string } | { oci: string };
type Workspace =
  | { empty: true }
  | { git: { repo: string; ref: string; branch?: string } }    // the result is that branch in that repo
  | { bind: { path: string; readOnly?: boolean } }
  | { snapshot: string };
interface SandboxSpec {
  provider?: string; image?: Image; workspace?: Workspace;
  resources: { cpus: number; memoryMiB: number; pids: number; diskMiB?: number; gpus?: number };
  network: { egress: "none" } | { egress: "open" } | { egress: "allowlist"; hosts: string[] };
  storage?: { volumes?: { name: string; mount: string; readOnly?: boolean }[];
              data?: { source: string; mount: string; readOnly?: boolean }[] };
  env?: Record<string, string>; secrets?: string[];
  timeoutSec: number; labels?: Record<string, string>; priority?: number;
}

interface SandboxProvider {
  id: string;
  capabilities: Capabilities;      // isolation class, which limits it enforces, egress modes,
                                   // image kinds, workspace kinds, ports, pause, snapshot, secret injection
  create(id, spec, signal?): Promise<void>;
  exec(id, request, signal?): Promise<ExecResult>;
  readFile(id, path); writeFile(id, path, bytes); listFiles(id, path);
  snapshot?(id): Promise<{ snapshotId: string }>;
  pause?(id); resume?(id); previewUrl?(id, port);
  destroy(id): Promise<void>;
  list(): Promise<string[]>;        // ids it still holds, for reconciliation
}
```

The contract makes these promises, and the suite checks each of them over every provider:

- `create` **refuses** anything outside `capabilities`, such as an egress mode, an image kind, a
  workspace kind, ports, GPUs or secrets. It never runs with less than was asked.
- Exec is **argv, not a shell string**, starts in `/workspace`, and sees only the spec's `env`.
  It reports `timedOut` and kills everything it started when the timeout or the sandbox's
  lifetime ends.
- **Files stay inside `/workspace`**: no `..`, and no symlink the sandbox planted.
- A sandbox **cannot see the host's home, SSH keys or bb data**, and has **no network** with
  egress `none`.
- **`destroy` is total and idempotent**, and `list` no longer reports the sandbox afterwards.
- A `git` workspace's **result is its branch**: commits made in `/workspace` (by an agent on the
  host, or inside) are on `branch` in `repo` after `destroy`.

### 9.5 Providers

| id | Status | Isolation | Notes |
|---|---|---|---|
| `bwrap` | **built** | namespaces | Images: `nix` attrs and presets, built from the host's nixpkgs (`nix build -f <nixpkgs>`), read-only via `/nix/store`. Workspaces: `empty`, `git` (a host worktree on a new branch, bound at `/workspace` with `.git` and the repo's hooks path read-only), `bind`, `snapshot` (a tar of the workspace and home). Egress: `none` and `open`. No ports, pause, GPUs or secrets. Caps through the user slice. |
| `opensandbox` | slot (phase 2) | gVisor | REST to a loopback server, credential vault, allowlists, ports, Docker pause. |
| `e2b` | slot | Firecracker | Hosted; templates set the size; header-injected secrets; `fork`. |
| `upstash` | slot | Docker | Hosted; size tiers; `attachHeaders`; built-in agent run as an extension. |

A slot is a row in this table, not code. A provider id the registry does not know is refused at
`create`, like any other unsupported request.

### 9.6 The queue

The queue admits **sandboxes**, not calls. A sandbox holds its lease on the budget from admission
until it is destroyed or expires. Its states are `queued → running → destroyed | failed`.

- **Budget.** It comes from the host policy (§13): 3 sandboxes, 8 cores and 12 GiB on
  shared-server. The plugin's settings cannot raise it.
- **Admission.** A sandbox is admitted when the job count, the CPU budget and the memory budget all
  fit, and when PSI shows no CPU or memory pressure. Pressure only holds new admissions.
- **Ordering.** Priority first, then first-in first-out. The head is never overtaken by a smaller
  job.
- **Persistence.** Each record lives in `bb.storage.kv`. At load the service reconciles:
  - queued records re-enter the queue;
  - running records whose provider still holds the sandbox keep their lease;
  - expired or lost ones are destroyed or marked `failed: lost`.

  That covers an `app-bb` restart, a reload and a hardware reset.

### 9.7 What the proof of concept showed [measured]

The proof of concept was on `bb/sandbox-plugin-poc` (PR #112). The plugin PR replaces it.

- A sandbox is created in about 50 ms. It has hostname `sandbox`, and `/` holds only
  `dev home nix proc run tmp workspace`.
- It has no `~/.ssh` and no network by default. `--net open` reaches the internet.
- A timeout kills the command with exit 137.
- An over-budget request is refused.
- Six concurrent runs with a cap of 4 ran as 4 running and 2 waiting.

## 10. AgentSpec: one declarative run

An AgentSpec says **what the agent is, what it has, and what it must produce**. It is a JSON or
YAML file, versioned in the repo it works on, or built in TypeScript with the SDK. Its fields
borrow from Harbor's `task.toml` and job config, Upstash Box's `agent.run`, and the Claude Code,
Codex and opencode headless flags [doc], adapted to bb.

```yaml
schema: bb-sandbox/agent-spec@1
name: monument-${folder}
labels: { batch: vn-monuments-1, folder: "${folder}" }
matrix: { folder: [hue-citadel, hoi-an, my-son] }    # fan-out: one run per value

agent:
  harness: claude-code          # a bb provider id: claude-code, codex, acp-opencode, pi
  model: claude-sonnet-5-5      # required, always explicit; a Fable model is refused
  effort: medium
  timeoutSec: 3600              # the runner stops the thread after this

instructions:
  promptFile: briefs/monument.md          # or `prompt: "…"`; ${folder} is substituted
  guides:                                 # copied into the workspace under .agent/ and named in the prompt
    - { file: AGENTS.md }
    - { file: docs/style-guide.md }
    - { skill: .agents/skills/blender-scene }      # a SKILL.md directory

sensors:                                  # run in the sandbox after the agent's turn; the agent may run them too
  - { name: build, run: [npm, run, build], timeoutSec: 600 }
  - { name: render, run: [blender, -b, scenes/${folder}.blend, -P, tools/render.py], artifacts: [out/${folder}.png] }
  - { name: eval, run: [node, tools/eval.mjs, "${folder}"], kind: eval }   # last stdout line {"reward": 0.8} is recorded

sandbox:                                  # everything SandboxSpec says, except the workspace
  provider: bwrap
  image: { preset: blender }
  resources: { cpus: 2, memoryMiB: 3072, pids: 1024 }
  network: { egress: none }
  storage: { data: [{ source: /srv/monument-photos, mount: /data/photos }] }
  timeoutSec: 5400

workspace: { git: { repo: ., ref: main, subdir: "monuments/${folder}" } }

outputs:
  branch: sandbox/vn-monuments-1/${folder}   # default: sandbox/<batch>/<name>
  artifacts: ["out/**/*.png", "monuments/${folder}/README.md"]
```

**What the runner does, for each expanded spec** (`bb sandbox job submit specs/monuments.yaml`):

1. **Validate** the spec, and expand `matrix` into one run per combination. A Fable model or a
   missing harness or model refuses the whole batch.
2. **Queue** a sandbox for it, with the spec's priority. Admission waits for the budget.
3. **Prepare the workspace.**
   - Create the branch as a worktree, and copy the guides into `.agent/`.
   - Under step (a) the builder edits files on the host, so the branch is a host worktree that the
     sandbox binds at `/workspace`.
4. **Start the builder as a bb thread** (`bb.sdk.threads.spawn`).
   - It gets the spec's harness and model, a host environment on that worktree, and the
     coordinator as its parent.
   - Its brief names the sandbox, its sensors and its branch.
   - Its plugin metadata enables the `sandbox_*` tools.
   - The agent edits files directly and runs everything it builds or executes with
     `sandbox_exec`. It never runs it on the host.
5. **Wait** until the thread is idle or `agent.timeoutSec` passes, then stop its runtime.
6. **Run the sensors in the sandbox**, record their results, and copy their `artifacts`.
7. **Collect the outputs**:
   - the branch and its head commit;
   - a patch of anything left uncommitted (not committed for the agent);
   - artifact files;
   - the trajectory.
8. **Destroy the sandbox.** The branch stays.

**The trajectory** is kept per job under the plugin's state directory, as two files:

- `trajectory.json`, in [ATIF-v1.8](https://docs.harborframework.com/agents/atif), Harbor's
  Agent Trajectory Interchange Format. It holds the steps, with their messages, reasoning, tool
  calls and observations, and `final_metrics` from bb's token usage. bb-specific data goes in
  `extra`.
- `events.jsonl`, the raw bb events, lossless.

`bb sandbox job trajectory <id>` pages through it, and the builder thread stays in bb as the live
view.

**Fan-out and review.**

- One spec file with a `matrix`, or N files, or a script that builds specs with the SDK
  (`Jobs.submit(spec)`).
- The queue runs 3 at a time on shared-server.
- `bb sandbox job wait --label batch=…` blocks until the batch is done, and `bb sandbox job list`
  shows branches, sensor results and costs.
- The coordinator reviews each branch and merges or opens PRs. Only the host pushes.

**Later, with the same spec.**

- Step (b), the agent inside the sandbox, keeps the spec. The runner then starts the harness
  headless in the sandbox (`claude -p --output-format stream-json --bare`, `codex exec --json`,
  `opencode run --format json`).
- The model key is injected at the egress (§11), and the native transcript is converted to ATIF
  the same way.
- Step (c) runs the bb thread itself in a sandbox, through a machine provider. bb's own
  `environment-modal-sandbox` plugin already has the adapter shape: `SandboxBackend` mapped to
  `bb.experimental_machines`.

## 11. Security

The first version's security section, with the decisions in §8.

- **Secrets.**
  - Nothing enters a sandbox by default: the environment is cleared, and there is no home, SSH
    agent, git credentials, bb token or `~/.bb`.
  - `bwrap` refuses `secrets`. Header injection at the egress comes with the providers that have
    one.
  - Builders stay outside sandboxes, so no model credential is needed inside one.
- **Egress.** The default is `none`. `bwrap` offers `none` and `open` only; an allowlist needs a
  provider with an egress proxy.
- **Workspaces.**
  - A `git` workspace binds the worktree read-write, but `.git` and the repo's hooks path
    (`core.hooksPath`, such as `.githooks`) read-only. Sandboxed code therefore cannot plant a hook
    that the host's git, or the builder's own commits, would run.
  - The runner never commits for the agent. It records uncommitted changes as a patch, using
    `git diff`, which runs no hooks.
  - `bind` and `data` mounts refuse `/`, `$HOME` and any ancestor of them.
- **Caps.** There are five layers:
  1. The queue budget and the PSI gate.
  2. The `sandbox.slice` user slice: a hard ceiling with `CPUQuota`, `MemoryMax`,
     `MemorySwapMax=0` and `TasksMax`.
  3. Each exec's scope, capped at the sandbox's resources.
  4. `nice 19`.
  5. The sandbox's lifetime.

  If the host policy requires cgroups and the user bus is missing, `create` fails. It does not run
  uncapped.
- **Isolation class.** `bwrap` shares the host kernel: a seatbelt for the builders' own generated
  code, not a vault for hostile code. That waits for `opensandbox` with gVisor, or E2B.

## 12. Blender

**Host.**

- The `blender` stack (PR #114) installs Blender 5.2.2 from nixpkgs and `blender-mcp`, a stdio MCP
  server.
- Each agent session gets its **own headless Blender**. The session starts `blender -b` with
  [dcc-mcp-blender](https://github.com/dcc-mcp/dcc-mcp-blender) (MIT) inside it, and the bridge
  relays MCP between stdio and Blender's loopback HTTP endpoint.
- Blender stops when the session ends.
- The gateway and telemetry are off.
- The pin is a uv pin, installed on first use into a venv over Blender's own Python.
- [measured] Through the bridge, `load_skill blender-scripting` then
  `blender_scripting__execute_python` added Suzanne to the scene.

**Why dcc-mcp-blender** [doc]:

- It is the only maintained Blender MCP server that runs in background mode, with about 200 typed
  tools loaded on demand through skills. It is tested on Blender 4.5 and 5.2.
- ahujasid's add-on (32.9k stars, now `mcp-for-blender`) refuses `blender -b`: its command queue
  drains on GUI timers. The official Blender Lab MCP (Blender 5.1+) also needs a running UI for its
  live tools.
- ellmos-blender-use-mcp spawns a Blender per call. It is tiny (4 tools, 2 stars, alpha) and would
  auto-update from npm.

**Limits.**

- Viewport screenshots need a GUI, so a session renders with Cycles on the CPU or Workbench
  instead.
- EEVEE in background mode needs a GPU context. It is untested here, and the dGPU stays out of it
  given the resets.
- Registering `blender-mcp` with each harness is still manual. That is a recorded gap: no channel
  registers MCP servers.

**In sandboxes.**

- `image: { preset: blender }` puts the host's Blender (`/nix/store`, read-only) on the sandbox's
  PATH. Sensors and builders' code then run `blender -b … -P script.py` inside the sandbox.
- The MCP server is a host-side tool for builders outside sandboxes (step (a)). Inside a sandbox
  under step (b), the same `blender-mcp` runs if the image also carries uv's cached venv. That is
  for later.

## 13. NixOS: the `sandboxes` stack

`modules/stacks/sandboxes/` is a NixOS-only stack, imported from `modules/stacks/nixos.nix` and
enabled on shared-server. It owns the whole local capability:

```nix
my.stacks.sandboxes = {
  enable = true;                       # the bb plugin (my.pkgs.bbPlugins), bubblewrap, the policy
  budget = { sandboxes = 3; cpus = 8; memoryMiB = 12288; tasks = 8192; };
  people = [ "popemkt" ];              # lingering user managers, each with the capped sandbox.slice
  images = { blender = [ "blender" ]; browser = [ "chromium" ]; node = [ "nodejs_22" "git" ]; };
};
```

- **`/etc/bb-sandbox/policy.json`.** It is generated from these options and is the one home of
  the budget. It holds:
  - the budget and the default provider;
  - the store paths of `bwrap` and of the host's nixpkgs (for `nix` images);
  - the image presets;
  - whether cgroups are required.

  The plugin reads it, and the plugin's settings cannot raise it.
- **The slice.** `systemd.user.slices.sandbox` applies the same budget as the slice's hard ceiling:
  `CPUQuota = cpus × 100 %`, `MemoryMax`, `MemorySwapMax = 0`, `TasksMax`, `IOWeight = 10`.
- **Linger.** `users.users.<person>.linger = true` for `people`. The user manager starts at boot.
  The Plasma session already starts it at login, so this changes when it starts, not what it runs.
- **The SDK path.** `/etc/bb-sandbox/plugin` is the plugin's source from the applied revision, so
  scripts import `/etc/bb-sandbox/plugin/sdk/index.ts` (Node runs TypeScript directly).
- **Neither bb unit restarts.** A rebuild adds files, a slice and linger. The plugin installs
  through `bb-plugins-sync`.

## 14. Phased plan

| Phase | Delivers | State |
|---|---|---|
| 0 | Research, proof of concept | ✅ #111, #112 |
| 1 | This design (#111 update), Blender (#114) | this PR, #114 |
| 2 | The plugin: SDK, ops, CLI, tools, queue, `bwrap`, AgentSpec runner (step (a)), ATIF trajectories, contract suite; the `sandboxes` stack | plugin PR, for the owner's review |
| 3 | `opensandbox` provider and component: Docker, gVisor, allowlists, credential vault, ports | needs the owner's yes on Docker |
| 4 | Step (b): agent inside the sandbox, with model-key injection at the egress | after 3 |
| 5 | `e2b`, `upstash` providers | needs accounts |
| 6 | Step (c): bb thread in a sandbox, through a machine provider; a microVM local provider if gVisor is too slow | later |

## 15. Open questions

1. **Step (b) credentials:** an Anthropic API key, injected at the egress, or no step (b) at all
   while subscriptions are what the team uses?
2. **bytetum:** sandboxes for bytetum too? That needs linger for bytetum, and a split of the budget.
3. **Where specs live:** in each project's repo (`specs/*.yaml`, versioned with the code), or in a
   central kb of reusable specs?

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
- **Agent specs and trajectories:**
  - [Harbor tasks](https://docs.harborframework.com/tasks/configuration), [Harbor jobs](https://docs.harborframework.com/jobs/configs), [ATIF](https://docs.harborframework.com/agents/atif);
  - [mini-swe-agent](https://mini-swe-agent.com/latest/reference/agents/default/), [Claude Code headless](https://code.claude.com/docs/en/headless), [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [opencode CLI](https://opencode.ai/docs/cli/), [Agent Skills](https://agentskills.io/specification).
- **Blender MCP:**
  - [dcc-mcp-blender](https://github.com/dcc-mcp/dcc-mcp-blender), [mcp-for-blender (ahujasid)](https://github.com/ahujasid/blender-mcp) and its [add-on](https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py), [Blender Lab MCP](https://www.blender.org/lab/mcp-server/), [ellmos-blender-use-mcp](https://github.com/ellmos-ai/ellmos-blender-use-mcp), [nixpkgs blender](https://raw.githubusercontent.com/NixOS/nixpkgs/nixos-unstable/pkgs/by-name/bl/blender/package.nix).
- **bb:**
  - the builtin `environment-modal-sandbox` plugin (`providers/sandbox-backend.ts`) for step (c);
  - the `bb-plugin-authoring` skill references for bb 0.46.1 / SDK 0.6.49: CLI and agent tools, host entries and their 5-minute idle worker, background services, storage, machine providers and `MachineExecutor`, environment providers.

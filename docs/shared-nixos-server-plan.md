# Shared NixOS home server plan

## Decision

Use one physical NixOS server with a shared host base and one declarative NixOS
container per person. The host owns hardware, networking, Tailscale, container
lifecycle, and backup scheduling. Each container owns its users, Home Manager
configuration, application services, credentials, and persistent data.

This supports simultaneous use and multiple instances of the same software
without running separate virtual machines. Containers share the host kernel;
private networking lets both environments use the same internal application
ports. Memory and CPU limits are explicit policy choices rather than fixed VM
allocations.

The editable [runtime and repository diagram](diagrams/shared-nixos-server.tldraw)
shows this proposed arrangement. It is a design artifact, not a declaration that
the server has been provisioned. Existing Mac configurations remain supported.

## Ownership and isolation

| Layer | Owns |
|---|---|
| Physical host | Disks, boot, network, firewall, Tailscale identity, container definitions, resource budgets, backup jobs |
| Personal container | Private network namespace, users, Home Manager, systemd services, credentials, application state |
| Application instance | Dedicated service account, configuration, data directory, secrets, internal listening port |
| Shared storage | Only explicitly agreed directories, mounted with defined permissions and read/write access |

Both people can log in and run services at once. For example, each container can
run its own kb on port 9000 with separate graph data and credentials. Where a
person needs multiple instances within their own container, model instances in
the owning application stack once; do not copy its service implementation.

Keep host administration distinct from personal application access. Grant host
sudo only to the agreed administrators. Containers are a useful separation for
trusted co-owners, but do not provide privacy from host root or the independent
kernel boundary of a VM. Evaluate user namespaces and service sandboxing during
implementation; do not assume container root is harmless to the host.

Applications run under dedicated service users with access only to their own
state and explicitly mounted inputs. Avoid mounting an entire host home,
credential directory, container-management socket, or unrelated service data.
Use systemd filesystem restrictions and privilege controls appropriate to each
application. Add container or service resource limits if one workload can
otherwise exhaust the shared machine.

## Repository structure

```text
flake.nix
hosts/
  popemkt-work/                     # existing Mac
  popemkt-personal/                 # existing Mac
  shared-server/
    default.nix                    # host identity and assembly
    hardware-configuration.nix     # generated on actual hardware
    containers/
      popemkt.nix                  # personal environment and stack choices
      friend.nix                   # other person's environment and choices
users/
  popemkt/default.nix               # account and Home Manager choices
  friend/default.nix
modules/
  nixos/
    system/                        # reusable NixOS host base
    home-manager/                  # Linux-specific user configuration
  common/home-manager/             # portable user configuration
  stacks/
    vpn/                           # shared capability, platform implementations
    kb/
    ai-agents/
    backup/                        # backup capability if its scope warrants it
docs/
  shared-nixos-server-plan.md
  diagrams/shared-nixos-server.tldraw
```

Names are provisional until the machine and second account are identified.
Start with both personal configurations in this repo. A separate personal flake
can be introduced later through pinned module imports if independent ownership
becomes useful; it is not required for runtime isolation.

Add `nixosConfigurations.shared-server` for the physical machine. Its native
`containers.<name>.config` values import each personal environment. Container
configuration is evaluated as part of the host; separate VM configurations,
guest installers, and a custom container option system are unnecessary.

The host's `default.nix` assembles the concrete container definitions. Reusable
cross-cutting NixOS mechanisms live under `modules/nixos/system/`; application
options, service definitions, and package membership remain owned by their
functional stacks. Personal folders select capabilities and instance settings,
rather than carrying copied implementations.

## Reuse from the existing repository

Reuse the pinned flake inputs, stack option model, package-channel ownership,
portable Git/editor/terminal settings, and the existing VPN policy ownership.
Use the hardware's actual architecture for Linux package evaluation.

Before importing the common Home Manager configuration, separate terminal
essentials from workstation packages and move Mac-specific commands and paths
to their platform owner. The common package list currently includes desktop
software, and the NixOS Home Manager module needs to be completed rather than
treated as a working Linux base.

Adapt kb, VPN, and selected AI services to Linux through their existing
capability schemas. Keep shared configuration in one place and implement
launchd versus systemd at the platform boundary. Derive executable arguments,
environment, service origins, and instance settings from shared definitions
where applicable. Do not introduce parallel Linux-only copies of the stacks.

The existing `my.username` represents a primary user. Keep macOS primary-user
behavior scoped to Darwin; define each container's user context explicitly.
If host login accounts are provided for both people, declare both accounts and
their Home Manager configurations rather than applying one person's settings
globally. Do not overload the work/personal role with server identity.

Make behavior-preserving restructuring and Linux additions separate commits,
following the repo's [agent rules](../AGENTS.md). A deferred workaround must
follow the existing gap-recording mechanism.

## Remote access through Tailscale

Use one Tailscale identity on the physical host initially. Run ordinary OpenSSH
with separate authorized keys inside the containers. Tailscale supplies network
reachability; enabling Tailscale SSH is a separate decision.

Choose distinct host ports that forward to private container endpoints. These
are illustrative allocations, not reserved ports:

| Endpoint | Your container | Other container |
|---|---|---|
| SSH | Host port 2221 to container port 22 | Host port 2222 to container port 22 |
| kb | Host port 9000 to container port 9000 | Host port 9001 to container port 9000 |

Configure `privateNetwork`, stable private addresses, and explicit forwarding
or proxying with native NixOS mechanisms. Services must listen on the private
endpoint used by the forwarder, or have a suitable in-container proxy; a
loopback-only application cannot be reached by forwarding to the container IP.
If a current service only supports loopback, resolve that transport requirement
in its owning abstraction before exposing it.

Restrict forwarded endpoints to the intended tailnet users and traffic path.
Do not assume a host input-firewall rule also protects forwarded traffic:
inspect the generated forwarding/NAT rules and verify actual reachability.
Use application authentication and correct public-origin configuration where
required. Container network isolation alone is not an access policy.

Retain local console or LAN recovery access for initial enrollment and Tailscale
failures. Existing enrollment and control-plane ownership are documented in
[the Tailscale guide](tailscale.md).

## Data, secrets, and backups

Follow the existing [backup strategy](backup-strategy.md): declare configuration
in Git and recover accumulated application state through backups. Define private
persistent storage for each container and explicit mounts for shared data.
Container recreation or configuration changes must not discard application
state. Confirm the lifecycle behavior of the selected NixOS container storage
mechanism before depending on it.

Use encrypted secret management, with sops-nix as the initial candidate. Keep
decryption keys and recovery material separately recoverable. Scope each secret
to its intended service; plaintext credentials never belong in Git or the Nix
store.

Use Restic as the initial backup candidate with an independent destination,
separate backup sets, and defined restore permissions. Database exports or
quiescing must produce consistent application backups; a filesystem copy of a
running database is not automatically sufficient. Test restoration into a fresh
container before moving the only copy of important data.

## Implementation phases

### 1. Resolve the machine and administration choices

Record CPU architecture, RAM, disks, filesystem/encryption choices, host and
account names, host administrators, shared directories, initial applications,
and backup destination. Establish which services each person may access and
whether container configuration changes require host-admin review.

### 2. Prepare Linux reuse

Separate existing portable configuration from workstation and Darwin behavior.
Keep the existing Mac evaluations passing. Add Linux flake outputs, a minimal
NixOS base, and suitable Linux development/check tooling without evaluating
unsupported custom Mac packages on Linux.

### 3. Bootstrap the physical host

Install minimal NixOS locally, generate its hardware configuration, and import
the repo's shared host base. Set explicit initial `system.stateVersion` and
Home Manager state versions; these are compatibility settings, not routine
update knobs. Verify reboot, local recovery, SSH, and Tailscale enrollment.

### 4. Bring up two minimal containers

Declare separate private networks, persistent storage, login users, keys, and
Home Manager choices. Enable both at boot. Establish SSH forwarding and tailnet
access rules before adding applications. Verify each person can log in
simultaneously and cannot read the other's private state.

### 5. Add application services and backups

Implement Linux support in the owning stacks. Start with kb as a small service,
then migrate Cognee when its complete database and runtime dependencies are
accounted for. Configure secrets, service accounts, data ownership, backups,
public origins, and resource limits as needed. Validate two instances using the
same internal ports before switching clients.

### 6. Migrate state and operate the server

Restore data into the new environments, test the applications, and switch
clients one service at a time. Keep the source copy until recovery is proven.
Document update, rollback, container restart, secret recovery, and backup
restoration procedures. Add automated evaluation and targeted integration
checks to CI as Linux capability becomes real.

## Acceptance checks

- Both existing Mac configurations still evaluate; the new host evaluates and
  builds for its actual architecture.
- The physical host and both personal containers recover after reboot.
- Both people can connect concurrently using their own SSH keys.
- Two instances of the same application use separate state and credentials;
  identical internal ports do not collide.
- A normal user and service in either environment cannot read the other's
  private data or secrets. Only declared shared mounts are accessible.
- Tailnet rules allow the intended endpoints and deny the other person's
  private endpoints. Forwarded services are not inadvertently exposed on the
  LAN or public interfaces.
- Restarting or rebuilding one container preserves its state and does not
  require stopping the other, subject to shared-host maintenance.
- Backup restoration into a fresh container recovers usable application data.
- Resource limits, where configured, constrain a workload without exhausting
  the host or starving the other environment.

For implementation, run the repository's required Nix formatting, lint, and
evaluation gates. Add tests for the actual service and isolation contracts;
the current commit only records the plan and its editable diagram.

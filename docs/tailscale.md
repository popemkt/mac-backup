# Tailscale

## Ownership

The repository owns the intentional Tailscale configuration that can be
reviewed and reproduced safely:

- `flake.nix` owns the MagicDNS tailnet domain used by hosts and clients.
- `hosts/*` and `modules/stacks/vpn/*` own local app installation and
  `tailscale serve` declarations.
- `configs/tailscale/policy.hujson` owns grants, tag ownership, service host
  auto-approval, and Tailscale SSH authorization.
- `.github/workflows/tailscale-policy.yml` tests policy changes on pull
  requests and applies them after they reach `main`.

Device enrollment, node keys, OAuth secrets, user membership, and live device
inventory are mutable control-plane state. Do not commit them to this repo.

## One-Time GitOps Enrollment

The workflow uses Tailscale workload identity federation, so it does not need a
long-lived API key. In the Tailscale admin console, create a federated identity
for this GitHub repository with the `policy_file` scope. Add these three values
as GitHub Actions repository secrets:

| Secret | Value |
|---|---|
| `TS_OAUTH_ID` | federated identity client ID |
| `TS_AUDIENCE` | federated identity audience |
| `TS_TAILNET` | tailnet name shown beside the Tailscale logo |

The workflow stays green but skips synchronization while all three are absent.
A partial configuration fails loudly. After enrollment, pull requests validate
the policy and pushes to `main` apply it automatically.

## Services And Direct Ports

Cognee is exposed as `svc:cognee` on HTTPS. Its tagged host is automatically
approved by policy, but creating the Service identity the first time remains a
Tailscale control-plane operation.

Orca Mobile does not need another Service identity or reverse proxy. It talks
directly to the personal host on TCP 6768 through MagicDNS:

```text
ws://popemkt-personal.<tailnet-domain>:6768
```

The policy explicitly grants tailnet members access to that port on
`tag:cognee-host`.

## Current Compatibility Grant

The live tailnet started from Tailscale's unrestricted default policy. The
tracked policy preserves that wildcard grant so adopting GitOps cannot silently
break unrecorded traffic. The explicit Orca and Cognee grants are therefore
documentation today and become enforcement when the wildcard is removed.

Before removing it, inventory remaining machine-to-machine, subnet, exit-node,
SSH, and shared-device flows and add a policy test for each intended path.

## What Is Not Exported

The policy file is the primary reproducible Tailscale artifact. DNS resolver
settings, user membership, device approvals, key expiry, and account-level
preferences are not copied into dotfiles yet. Manage those in the control plane
until there is a concrete need for the official Terraform provider. Device
inventory should remain state, not declarative configuration.

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
long-lived API key. The current tailnet is already enrolled with this trust:

| Setting | Value |
|---|---|
| GitHub repository | `popemkt/mac-backup` |
| Credential description | `GitHubActionsPopemktMacBackup` |
| Credential type | OpenID Connect |
| Issuer | GitHub |
| Subject | `repo:popemkt/mac-backup:*` |
| Scope | Policy File, Write (the console includes Read) |

The subject admits workflows from this repository only. Tailscale exchanges
each GitHub-issued OIDC token for short-lived policy access; there is no OAuth
client secret or reusable Tailscale API key.

### Recreate The Trust

This is the complete manual bootstrap if the credential, tailnet, or GitHub
repository is replaced:

1. In the Tailscale admin console, open **Settings > Trust credentials**.
2. Select **Credential**, then **OpenID Connect**.
3. Use the alphanumeric description `GitHubActionsPopemktMacBackup`.
4. Select the **GitHub** issuer. Leave its generated issuer URL unchanged.
5. Set the subject to `repo:popemkt/mac-backup:*`. Leave audience and custom
   claims empty.
6. Continue to scopes and select **Policy File > Write** only. The console
   automatically includes Policy File Read.
7. Generate the credential and keep the result open until both the Client ID
   and Audience have been copied.
8. In GitHub, open **popemkt/mac-backup > Settings > Secrets and variables >
   Actions**, then create these repository secrets:

| Secret | Value |
|---|---|
| `TS_OAUTH_ID` | federated identity client ID |
| `TS_AUDIENCE` | federated identity audience |
| `TS_TAILNET` | tailnet name shown beside the Tailscale logo |

The equivalent CLI enrollment prompts for each value without putting it in the
repository:

```bash
gh secret set TS_OAUTH_ID --repo popemkt/mac-backup
gh secret set TS_AUDIENCE --repo popemkt/mac-backup
gh secret set TS_TAILNET --repo popemkt/mac-backup
```

Verify the complete path rather than assuming that secret presence means the
trust works:

```bash
gh workflow run tailscale-policy.yml --repo popemkt/mac-backup --ref main
gh run list --repo popemkt/mac-backup --workflow tailscale-policy.yml --limit 1
gh run watch --repo popemkt/mac-backup <run-id> --exit-status
```

The workflow stays green but skips synchronization while all three are absent.
A partial configuration fails loudly. After enrollment, pull requests validate
the policy and pushes to `main` apply it automatically.

Console policy edits are emergency changes, not durable configuration. The next
successful apply replaces them with `configs/tailscale/policy.hujson`. If an
apply fails, Tailscale keeps the previous live policy; inspect it with
`gh run view --repo popemkt/mac-backup <run-id> --log-failed`.

## Services And Direct Ports

Cognee is exposed as `svc:cognee` on HTTPS. Its tagged host is automatically
approved by policy, but creating the Service identity the first time remains a
Tailscale control-plane operation.

### First Tailnet Or Replacement Host

The remaining manual control-plane steps are:

1. Sign the machine into Tailscale from the menu bar. Device identity and node
   keys must never be committed.
2. For a new tailnet, open **Services** in the Tailscale console and create
   `svc:cognee` once.
3. Apply the tracked policy through the GitHub workflow so that
   `tag:cognee-host`, its owner, grants, and the Service auto-approver exist.
4. Open **Machines**, select the Cognee server, edit its tags, and assign
   `tag:cognee-host`.
5. Rebuild the host. The `tailscale-services` launchd job advertises
   `svc:cognee`; policy automatically approves the tagged host.
6. Confirm `tailscale status --json` reports the tag and `services/cognee`, then
   test `https://cognee.<tailnet-domain>` from another tailnet device.

For a replacement host in the same tailnet, the Service and policy already
exist; repeat steps 1, 4, 5, and 6.

Orca Mobile does not need another Service identity or reverse proxy. It talks
directly to the personal host on TCP 6768 through MagicDNS:

```text
ws://popemkt-personal.<tailnet-domain>:6768
```

The policy explicitly grants tailnet members access to that port on
`tag:cognee-host`.

### Orca Mobile Pairing

Pairing codes are bearer credentials containing a device token and public key.
Never commit one, paste one into an issue or agent transcript, or reuse a code
after exposure.

1. Put the phone on the same tailnet and confirm it can resolve
   `popemkt-personal.<tailnet-domain>`.
2. In desktop Orca, open **Orca Mobile**. Choose **Get started** or **Pair
   another device**, continue to **Pair this**, and use local-network pairing.
3. Generate the code. The desktop may encode the current Tailscale IP; that is
   valid, but the durable endpoint is
   `ws://popemkt-personal.<tailnet-domain>:6768`.
4. If an agent rewrites the code, it must base64url-decode only the `code`
   payload, replace only the JSON `endpoint`, preserve `v`, `deviceToken`,
   `publicKeyB64`, and `scope`, then base64url-encode it without padding.
5. Put the resulting `orca://pair?code=...` URI directly on the user's local
   clipboard or show Orca's QR. Validate only the scheme, endpoint, scope, and
   presence of token/key; never print the token in logs.
6. Paste the URI into Orca Mobile's **Pair Desktop** flow. Regenerate the code
   from desktop Orca if pairing fails or if the code may have been exposed.

Before handing off a code, verify the listener without revealing credentials:

```bash
nc -vz popemkt-personal.<tailnet-domain> 6768
```

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

This table is the manual-state inventory agents should check before inventing a
new configuration path:

| External state | Where it lives | Recreate/verify |
|---|---|---|
| Tailnet account and membership | Tailscale | Admin console **Users** |
| Machine login and node keys | Each device + Tailscale | Menu-bar sign-in and **Machines** |
| `tag:cognee-host` assignment | Tailscale machine record | **Machines > Edit tags** |
| `svc:cognee` identity | Tailscale | Admin console **Services** |
| GitHub OIDC trust credential | Tailscale | **Settings > Trust credentials** |
| Enrollment values | GitHub Actions secrets | `gh secret list --repo popemkt/mac-backup` |
| Policy, tag owner, grants, SSH, auto-approver | This repository | `configs/tailscale/policy.hujson` |
| Local app and Service advertisement | This repository | Nix VPN stack and host declaration |
| DNS/account preferences | Tailscale | Admin console **DNS** and **Settings** |

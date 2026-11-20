# Private ntfy on shared-server

ntfy runs on the owner-only socket `/run/ntfy/ntfy.sock`. It requires
credentials for all topic access, including `up*`. The Tailscale policy
reserves `svc:ntfy-popemkt` for `hoangng71299@gmail.com`, but the current
catch-all policy also admits other tailnet members. The app's tailnet
exposure is off, so there is no listener for the phone yet.

Upstream's [private UnifiedPush setup](https://docs.ntfy.sh/config/#example-unifiedpush)
requires anonymous writes to `up*` so third-party application servers can
deliver push messages. That rule and tailnet exposure are deferred to the
owner's access-policy decision. The kb host publisher can use the local
socket and a token in the meantime.

## Set up and send a notification from the host

1. After merge, have the shared-server operator apply the merged
   configuration using the normal `rebuild`.
2. On shared-server, as `popemkt`, run `ntfy-setup`. Save the password in
   your password manager. The command writes the host publisher token to
   `~/.config/ntfy/token` with mode 0600. Run `ntfy-setup --reset-password`
   to issue a new password, including after interrupted account setup.
3. Publish through the local socket. Curl reads the header from stdin to
   keep the token out of its command line.

   ~~~bash
   printf 'Authorization: Bearer %s\n' "$(cat "$HOME/.config/ntfy/token")" |
     curl --fail --silent --show-error --header @- \
       --unix-socket /run/ntfy/ntfy.sock \
       --data 'shared-server notification test' http://localhost/host-attention
   ~~~

## Phone setup once exposure is approved

Enable `my.stacks.ntfy.servers.ntfy.expose` in the host configuration.
On merge, the Services workflow creates `svc:ntfy-popemkt`. Verify the
Service and policy workflows succeeded before applying the new host
configuration. Run `ntfy-setup` for the HTTPS URL. On `poco-f8-pro`,
connect Tailscale as the owner, install
[ntfy from F-Droid or Google Play](https://docs.ntfy.sh/subscribe/phone/),
set the HTTPS URL as the default server, add the `popemkt` login, enable
instant delivery, and subscribe to `host-attention`. Publishers keep using
tokens for ordinary topics. Configure UnifiedPush only after the owner
approves the separate delivery exception and network path.

Back up `/srv/ntfy` as described in [container state](backup-strategy.md#nixos-container-state).
It contains the message and user databases and attachments. Treat the host
publisher token as a credential. The Compose bundle is under
`/etc/app-containers/ntfy/`.

<!-- GAP [[01M7WXKQ80V0WNJP35KTK6YS1Y]]: kb publishing and the Android connector belong in popemkt/kb. -->

# Private ntfy on shared-server

`svc:ntfy-popemkt` belongs to the Tailscale login
`hoangng71299@gmail.com`, including `poco-f8-pro`. Its public origin is the
Service's tailnet HTTPS URL. ntfy runs on an owner-only Unix socket behind
Tailscale and denies anonymous access by default. The
[UnifiedPush rule](https://docs.ntfy.sh/config/#example-unifiedpush) gives
anonymous writers access to `up*` topics. Reads and ordinary topics require
authentication. A UnifiedPush sender needs a network path to the Service.

## Set up and send a notification

1. After merge, verify that the **Tailscale Services** and **Sync Tailscale
   policy** workflows succeeded. The Services workflow creates
   `svc:ntfy-popemkt`. If identity creation fails, see
   [Tailscale setup](tailscale.md). Have the shared-server operator apply the
   merged configuration using the normal `rebuild`.
2. On shared-server, as `popemkt`, run `ntfy-setup`. Save the password it
   prints in your password manager. The command prints the HTTPS URL and
   writes the publisher token to `~/.config/ntfy/token` with mode 0600.
   Run `ntfy-setup --reset-password` to issue a new password, including
   when setup is interrupted after the account is created.
3. On `poco-f8-pro`, connect Tailscale as the owner. Install
   [ntfy from F-Droid or Google Play](https://docs.ntfy.sh/subscribe/phone/).
   Under ntfy **Settings**, set **Default server** to the printed HTTPS URL
   and add the `popemkt` login for that server. Tap **+** and subscribe to
   `host-attention` on that server. Enable instant delivery for a direct
   connection to the private server. For apps that support UnifiedPush,
   also enable UnifiedPush in ntfy and select ntfy as their distributor.
4. As `popemkt` on shared-server, publish through the local socket. Curl
   reads the header from stdin to keep the token out of its command line.

   ~~~bash
   printf 'Authorization: Bearer %s\n' "$(cat "$HOME/.config/ntfy/token")" |
     curl --fail --silent --show-error --header @- \
       --unix-socket /run/ntfy/ntfy.sock \
       --data 'shared-server notification test' http://localhost/host-attention
   ~~~

Back up `/srv/ntfy` as described in [container state](backup-strategy.md#nixos-container-state).
It contains the message and user databases and attachments. Treat the host
publisher token as a credential. The Compose bundle is under
`/etc/app-containers/ntfy/`.

<!-- GAP [[01M7WXKQ80V0WNJP35KTK6YS1Y]]: kb publishing and the Android connector belong in popemkt/kb. -->

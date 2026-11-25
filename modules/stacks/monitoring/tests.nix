{ pkgs }:

# checks.x86_64-linux.monitoring: the monitoring stack under its real units
# (docs/monitoring.md → Tests). Two stand-ins:
#   - ntfy: ./tests/ntfy-standin.py on the owner-only socket /run/alerts, as
#     the owner, checking the owner's token and logging each message. Its
#     server entry is `alerts`, not `ntfy`, so the alerts reach it only
#     through the selected server's publisher (`ntfy-publish-alerts`);
#   - tailscale: answers `serve status --json` from a file the test writes,
#     for the Funnel drift check.
let
  inherit (pkgs) lib;
  login = "owner@example.com";
  edgePaths = [
    "/mcp"
    "/.well-known/oauth-protected-resource"
  ];
  edgeTarget = "http://127.0.0.1:4190";

  fakeTailscale = pkgs.writeShellScriptBin "tailscale" ''
    if [ "$*" = "serve status --json" ]; then
      exec ${pkgs.coreutils}/bin/cat /var/lib/fake-tailscale/status.json
    fi
    echo "fake tailscale: unsupported: $*" >&2
    exit 64
  '';
  # A foreground `tailscale funnel 8443` session, as tailscaled keeps one.
  foregroundFunnel.session-1 = {
    TCP."8443".HTTPS = true;
    Web."server.example.ts.net:8443".Handlers."/".Proxy = "http://127.0.0.1:9999";
    AllowFunnel."server.example.ts.net:8443" = true;
  };
  # Twelve error events, as Keycloak's jboss-logging listener logs them.
  keycloakNoise = pkgs.writeShellScript "keycloak-noise" ''
    for _ in $(${pkgs.coreutils}/bin/seq 12); do
      echo 'WARN  [org.keycloak.events] (executor-thread-1) type="LOGIN_ERROR", realmName="kb", error="invalid_user_credentials"'
    done
  '';
in
pkgs.testers.runNixOSTest {
  name = "monitoring";

  nodes.machine =
    { config, ... }:
    {
      imports = [
        ../../options
        ../vpn/default.nix
        ../vpn/nixos.nix
        ../ntfy/default.nix
        ./default.nix
      ];

      virtualisation = {
        memorySize = 2048;
        cores = 2;
      };

      my = {
        hostname = "server";
        people = [ "owner" ];
        stacks = {
          vpn = {
            tailnetDomain = "example.ts.net";
            # The MCP edge's entry, as it declares one: through Funnel, at
            # its public paths only.
            nodeServe.mcp-edge = {
              target = edgeTarget;
              paths = edgePaths;
              funnel = true;
            };
          };
          # The server's entry, for its publisher; the stand-in below runs
          # in its place, so the stack itself stays off.
          ntfy.servers.alerts.owner = "owner";
          monitoring = {
            enable = true;
            alerts = {
              enable = true;
              server = "alerts";
              keycloakUnit = "keycloak.service";
            };
            dashboard = {
              enable = true;
              inherit login;
            };
          };
        };
      };
      services.tailscale.package = fakeTailscale;

      users.users.owner = {
        isNormalUser = true;
        uid = 1000;
      };

      systemd.services = {
        ntfy-standin = {
          wantedBy = [ "multi-user.target" ];
          serviceConfig = {
            User = "owner";
            RuntimeDirectory = "alerts";
            RuntimeDirectoryMode = "0700";
            StateDirectory = "ntfy-standin";
            ExecStart = "${pkgs.python3}/bin/python3 -I ${./tests/ntfy-standin.py} /run/alerts/ntfy.sock ${config.my.stacks.ntfy.publishers.alerts.tokenFile} /var/lib/ntfy-standin/messages.jsonl";
          };
        };
        # Services that fail when started: a plain one, a template instance,
        # and one that fails while ntfy is down.
        flaky.serviceConfig = {
          Type = "oneshot";
          ExecStart = "${pkgs.bash}/bin/bash -c 'echo flaky-says-goodbye; exit 3'";
        };
        "flaky-template@".serviceConfig = {
          Type = "oneshot";
          ExecStart = "${pkgs.coreutils}/bin/false";
        };
        flaky-offline.serviceConfig = {
          Type = "oneshot";
          ExecStart = "${pkgs.coreutils}/bin/false";
        };
      };

      environment.systemPackages = [
        pkgs.jq
        pkgs.e2fsprogs
      ];
    };

  testScript =
    let
      # What tailscaled reports when the edge's entry is served with Funnel,
      # plus `extra` paths, plus `foreground` sessions.
      status =
        extra: foreground:
        pkgs.writeText "serve-status.json" (
          builtins.toJSON {
            Foreground = foreground;
            TCP."443".HTTPS = true;
            Web."server.example.ts.net:443".Handlers = lib.genAttrs (edgePaths ++ extra) (path: {
              Proxy = edgeTarget + path;
            });
            AllowFunnel."server.example.ts.net:443" = true;
          }
        );
    in
    ''
      import json

      machine.wait_for_unit("multi-user.target")
      machine.succeed(
          "install -d -o owner -m 0700 /home/owner/.config /home/owner/.config/ntfy",
          "printf 'tk_standin\\n' > /home/owner/.config/ntfy/token",
          "chown owner /home/owner/.config/ntfy/token && chmod 0600 /home/owner/.config/ntfy/token",
          "install -d -m 0700 /var/lib/fake-tailscale",
          "cp ${status [ ] { }} /var/lib/fake-tailscale/status.json",
      )
      machine.wait_for_unit("ntfy-standin.service")
      machine.wait_for_file("/run/alerts/ntfy.sock")

      def messages(title_part):
          out = machine.succeed("cat /var/lib/ntfy-standin/messages.jsonl 2>/dev/null || true")
          found = [json.loads(line) for line in out.splitlines() if line]
          return [m for m in found if title_part in (m["title"] or "")]

      def health():
          # One run of the checks, to completion (reset-failed clears the
          # start limit that back-to-back runs would hit).
          machine.succeed("systemctl reset-failed monitoring-health.service; systemctl start monitoring-health.service")

      def notifier_done(unit):
          # The notifier for <unit> has run (oneshot: inactive or failed again).
          machine.wait_until_succeeds(
              f"journalctl -u 'monitoring-unit-failed@{unit}.service' -o cat | grep -E 'Finished|Failed with result|failed with result'"
          )

      with subtest("a failed service alerts once, naming it, with its journal"):
          machine.fail("systemctl start flaky.service")
          machine.wait_until_succeeds("grep -q 'flaky.service failed on server' /var/lib/ntfy-standin/messages.jsonl")
          [alert] = messages("flaky.service failed on server")
          assert alert["topic"] == "host-attention", alert
          assert alert["priority"] == "high", alert
          assert "flaky-says-goodbye" in alert["message"], alert["message"]
          # Again within the cooldown: logged, not sent.
          machine.succeed("systemctl reset-failed monitoring-unit-failed@flaky.service || true")
          machine.fail("systemctl start flaky.service")
          machine.wait_until_succeeds(
              "journalctl -u monitoring-unit-failed@flaky.service -o cat | grep -q 'not again within'"
          )
          assert len(messages("flaky.service failed on server")) == 1

      with subtest("a template instance's failure alerts too"):
          machine.fail("systemctl start flaky-template@one.service")
          machine.wait_until_succeeds(
              "grep -q 'flaky-template@one.service failed on server' /var/lib/ntfy-standin/messages.jsonl"
          )

      with subtest("a notifier that fails does not notify about itself"):
          out = machine.succeed("systemctl show -p OnFailure --value monitoring-unit-failed@x.service").strip()
          assert out == "", f"the notifier has OnFailure={out}"
          machine.succeed("systemctl stop ntfy-standin.service")
          machine.fail("systemctl start flaky-offline.service")
          machine.wait_until_succeeds("systemctl is-failed monitoring-unit-failed@flaky-offline.service")
          machine.sleep(5)
          loops = machine.succeed(
              "systemctl list-units --all --plain --no-legend 'monitoring-unit-failed@monitoring-unit-failed*'"
          ).strip()
          assert loops == "", f"the notifier notified about itself: {loops}"
          # Nothing was recorded, so once ntfy is back the next failure is sent.
          machine.succeed("systemctl start ntfy-standin.service")
          machine.wait_for_file("/run/alerts/ntfy.sock")
          machine.succeed("systemctl reset-failed monitoring-unit-failed@flaky-offline.service")
          machine.fail("systemctl start flaky-offline.service")
          machine.wait_until_succeeds(
              "grep -q 'flaky-offline.service failed on server' /var/lib/ntfy-standin/messages.jsonl"
          )

      with subtest("many failures at once: the burst limit, then one summary"):
          # An empty burst window: the alerts above do not count.
          machine.succeed("rm -f /var/lib/monitoring/unit-failed/sent")
          machine.succeed("systemctl start --no-block " + " ".join(f"flaky-template@b{i}.service" for i in range(1, 9)))
          machine.wait_until_succeeds(
              "test \"$(journalctl -o cat -u 'monitoring-unit-failed@flaky-template@b*' "
              + "| grep -cE 'alerted: flaky-template@b[0-9].service failed|flaky-template@b[0-9].service failed; .*next summary')\" = 8"
          )
          singles = [m for m in messages("flaky-template@b") if "failed on server" in m["title"]]
          assert len(singles) == 5, [m["title"] for m in singles]
          health()
          [summary] = messages("3 more services failed on server")
          queued = {f"flaky-template@b{i}.service" for i in range(1, 9)} - {m["title"].split(" ")[0] for m in singles}
          assert all(u in summary["message"] for u in queued), (queued, summary["message"])
          health()
          assert len(messages("more services failed")) == 1

      with subtest("a summary batch a dead health run left behind is still sent"):
          # A run that died after taking the queue (pending.sending), and a
          # failure queued since (pending): the next run sends both.
          machine.succeed(
              "printf 'stranded-a.service\\n' > /var/lib/monitoring/unit-failed/pending.sending",
              "printf 'queued-b.service\\n' >> /var/lib/monitoring/unit-failed/pending",
          )
          health()
          [batch] = messages("2 more services failed on server")
          assert "stranded-a.service" in batch["message"] and "queued-b.service" in batch["message"], batch["message"]
          machine.fail("test -e /var/lib/monitoring/unit-failed/pending.sending")
          health()
          assert len(messages("2 more services failed on server")) == 1

      with subtest("a full disk alerts once, and its recovery once"):
          machine.succeed(
              "truncate -s 64M /root/small.img",
              "mkfs.ext4 -q /root/small.img",
              "mkdir -p /mnt/small",
              "mount -o loop /root/small.img /mnt/small",
          )
          health()
          assert messages("Disk /mnt/small") == [], messages("Disk /mnt/small")
          machine.succeed("dd if=/dev/zero of=/mnt/small/fill bs=1M count=60 || true")
          health()
          health()
          full = messages("Disk /mnt/small full")
          assert len(full) == 1, full
          assert "/mnt/small" in full[0]["message"] and "threshold is 90%" in full[0]["message"], full
          machine.succeed("rm /mnt/small/fill")
          health()
          health()
          recovered = messages("Recovered: Disk /mnt/small full")
          assert len(recovered) == 1, recovered
          assert len(messages("Disk /mnt/small")) == 2

      with subtest("Funnel drift: a planted extra path alerts once"):
          health()
          assert messages("Tailscale serve drift") == []
          machine.succeed("cp ${status [ "/admin" ] { }} /var/lib/fake-tailscale/status.json")
          health()
          health()
          [drift] = messages("Tailscale serve drift")
          assert "/admin" in drift["message"], drift["message"]
          machine.succeed("cp ${status [ ] { }} /var/lib/fake-tailscale/status.json")
          health()
          assert len(messages("Recovered: Tailscale serve drift")) == 1

      with subtest("Funnel drift: a foreground tailscale funnel session alerts"):
          machine.succeed("cp ${status [ ] foregroundFunnel} /var/lib/fake-tailscale/status.json")
          health()
          drifts = [m for m in messages("Tailscale serve drift") if m["title"] == "Tailscale serve drift on server"]
          assert len(drifts) == 2, drifts
          assert "8443" in drifts[1]["message"] and "foreground" in drifts[1]["message"], drifts[1]["message"]
          machine.succeed("cp ${status [ ] { }} /var/lib/fake-tailscale/status.json")
          health()
          assert len(messages("Recovered: Tailscale serve drift")) == 2

      with subtest("a burst of Keycloak error events alerts"):
          machine.succeed("systemd-run --unit=keycloak --wait ${keycloakNoise}")
          health()
          [signins] = messages("Keycloak sign-in errors")
          assert "12 Keycloak error events" in signins["message"], signins["message"]

      with subtest("Beszel answers on its socket, only for the trusted identity"):
          machine.wait_for_unit("beszel-hub.service")
          machine.wait_for_unit("beszel-agent.service")
          sock = "--unix-socket /run/beszel-hub-proxy/beszel.sock http://localhost"
          machine.wait_until_succeeds(f"curl -sf {sock}/api/health")
          # No identity, or someone else's: refused.
          machine.succeed(f"test \"$(curl -s -o /dev/null -w '%{{http_code}}' {sock}/api/beszel/info)\" = 401")
          machine.succeed(
              f"test \"$(curl -s -o /dev/null -w '%{{http_code}}' -H 'Tailscale-User-Login: intruder@example.com' {sock}/api/beszel/info)\" = 401"
          )
          machine.succeed(f"curl -sf -H 'Tailscale-User-Login: ${login}' {sock}/api/beszel/info")
          # Password sign-in is off.
          machine.succeed(f"curl -sf {sock}/api/collections/users/auth-methods | jq -e '.password.enabled == false'")
          # Nobody but root reaches the hub to forge the header: its port is
          # in a namespace of its own, and the socket is root's.
          machine.fail("curl -s --max-time 5 http://127.0.0.1:8090/api/health")
          machine.fail(f"su owner -c 'curl -sf {sock}/api/health'")
          # The hub sees this machine through the agent.
          machine.wait_until_succeeds(
              f"curl -sf -H 'Tailscale-User-Login: ${login}' {sock}/api/collections/systems/records"
              + " | jq -e '.items | length == 1 and .[0].status == \"up\"'",
              timeout=180,
          )
    '';
}

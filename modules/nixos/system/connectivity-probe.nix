{ lib, pkgs, ... }:

# A tripwire for outbound reachability. Every 5 minutes it opens a TCP
# connection to a few fixed IPv4 and IPv6 endpoints and logs one line with the
# result and the host's own state. The next outage then leaves data that says
# whether it was this host (connection fan-out, Wi-Fi, a local route) or the
# router or ISP: IPv4 TCP failing while ICMP and IPv6 work is the router/ISP
# signature seen on 2026-11-06.
#
#   journalctl -u connectivity-probe            every probe
#   journalctl -u connectivity-probe -p warning only the failed ones
let
  # Literals first: they need no DNS, so a failure is the path, not the
  # resolver. github.com is the one name, since a GitHub outage was the symptom.
  tcpTargets = [
    {
      family = 4;
      host = "1.1.1.1";
      port = 443;
    }
    {
      family = 4;
      host = "8.8.8.8";
      port = 443;
    }
    {
      family = 4;
      host = "github.com";
      port = 443;
    }
    {
      family = 6;
      host = "2606:4700:4700::1111";
      port = 443;
    }
    {
      family = 6;
      host = "2001:4860:4860::8888";
      port = 443;
    }
  ];

  probe = pkgs.writeShellApplication {
    name = "connectivity-probe";
    runtimeInputs = with pkgs; [
      bash
      coreutils
      getent
      gnugrep
      iproute2
      iputils
    ];
    text = ''
      # tcp FAMILY HOST PORT: print the connect time, or why it failed.
      tcp() {
        local family=$1 host=$2 port=$3 addr start rc=0
        addr=$(getent "ahostsv$family" "$host" | head -n1 | cut -d' ' -f1) || true
        if [ -z "$addr" ]; then
          echo "no-address"
          return 1
        fi
        start=$EPOCHREALTIME
        # The inner shell, not this one, expands $0 and $1.
        # shellcheck disable=SC2016
        timeout 5 bash -c 'exec 3<>"/dev/tcp/$0/$1"' "$addr" "$port" 2>/dev/null || rc=$?
        case $rc in
          0) echo "$(((''${EPOCHREALTIME/./} - ''${start/./}) / 1000))ms" ;;
          124) echo "timeout"; return 1 ;;
          *) echo "refused"; return 1 ;;
        esac
      }

      icmp() {
        if ping -n -c1 -W3 "$1" >/dev/null 2>&1; then echo ok; else echo fail; fi
      }

      failed=0
      tcp4="" tcp6=""
      ${lib.concatMapStrings (t: ''
        if out=$(tcp ${toString t.family} ${t.host} ${toString t.port}); then :; else failed=1; fi
        tcp${toString t.family}+="${t.host}:${toString t.port}=$out "
      '') tcpTargets}

      gateway=none dev=none
      read -ra route < <(ip -4 route show default | head -n1) || true
      if [ "''${#route[@]}" -ge 5 ]; then gateway=''${route[2]} dev=''${route[4]}; fi
      icmp_gateway=na
      if [ "$gateway" != none ]; then icmp_gateway=$(icmp "$gateway"); fi
      icmp_internet=$(icmp 8.8.8.8)

      wifi=na
      if line=$(grep "^ *$dev:" /proc/net/wireless 2>/dev/null); then
        read -r _ _ link level _ <<<"$line"
        wifi="link=''${link%.} level=''${level%.}dBm"
      fi

      conntrack=na
      if [ -r /proc/sys/net/netfilter/nf_conntrack_count ]; then
        conntrack="$(cat /proc/sys/net/netfilter/nf_conntrack_count)/$(cat /proc/sys/net/netfilter/nf_conntrack_max)"
      fi
      state() { ss -Hnt state "$1" | wc -l; }

      level=6 verdict=ok
      if [ "$failed" = 1 ]; then level=4 verdict=FAIL; fi
      echo "<$level>connectivity-probe: $verdict" \
        "v4[''${tcp4% }] v6[''${tcp6% }] icmp[gateway=$icmp_gateway 8.8.8.8=$icmp_internet]" \
        "route=$gateway/$dev wifi[$wifi] conntrack=$conntrack" \
        "established=$(state established) syn-sent=$(state syn-sent) time-wait=$(state time-wait)"

      # Who holds the connections, when something failed.
      if [ "$failed" = 1 ]; then
        { ss -Htnap | grep -o 'users:(("[^"]*"' | sort | uniq -c | sort -rn | head -n5 |
          sed "s/^/<4>connectivity-probe: sockets by process:/"; } || true
      fi
    '';
  };
in
{
  systemd.services.connectivity-probe = {
    description = "Log outbound IPv4 and IPv6 TCP reachability";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe probe;
      # Root, for ICMP and for naming the processes behind sockets; nothing
      # else about it needs privilege.
      Nice = 15;
      CPUSchedulingPolicy = "idle";
      IOSchedulingClass = "idle";
      TimeoutStartSec = 90;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      NoNewPrivileges = true;
    };
  };

  systemd.timers.connectivity-probe = {
    description = "Probe outbound reachability every 5 minutes";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "2min";
      OnUnitActiveSec = "5min";
      AccuracySec = "10s";
    };
  };
}

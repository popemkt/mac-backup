{ pkgs }:

let
  ntfyImage = pkgs.ntfy-image;
  # A stationary fixture for the pre-upgrade generation. The second
  # generation follows the normal ntfy pin.
  previousImage = pkgs.dockerTools.pullImage {
    imageName = "binwiederhier/ntfy";
    imageDigest = "sha256:771309aecfce18d8fe2bfb8069994ddd6be6ca6ccdd7badace3d791a0045ff0d";
    hash = "sha256-UPTCnPBLeZWz2q0wLXTL44R2P80jhc4dat/7znbHK3w=";
    finalImageTag = "v2.38.0";
    os = "linux";
    arch = "amd64";
  };
in
pkgs.testers.runNixOSTest {
  name = "app-containers";
  nodes.machine = { lib, pkgs, ... }: {
    imports = [
      ../../../options/services.nix
      ../../../stacks/ntfy
      ../../../stacks/vpn/default.nix
      ../services.nix
    ];
    options.my = {
      people = lib.mkOption { default = [ "owner" ]; };
      pkgs.npmGlobals = lib.mkOption { default = [ ]; };
      stacks.t3-code.enable = lib.mkEnableOption "T3 Code";
    };
    config =
      let
        placement =
          image: address:
          (import ../../../stacks/ntfy/placement.nix {
            inherit pkgs image;
          } ({ owner = "owner"; } // address))
          // {
            expose = false;
          };
      in
      {
        users.users.owner = {
          isNormalUser = true;
          uid = 1000;
        };
        environment.systemPackages = [
          pkgs.curl
          pkgs.sqlite
        ];
        my.stacks.vpn = {
          enable = true;
          tailnetDomain = "example.test";
        };
        my.stacks.ntfy = {
          enable = true;
          servers.ntfy-socket.owner = "owner";
        };
        my.services = {
          ntfy-port = placement previousImage {
            port = 2586;
            baseUrl = "http://127.0.0.1:2586";
          };
        };
        specialisation.upgrade.configuration.my.services.ntfy-port.image = lib.mkForce ntfyImage;
      };
  };
  testScript = ''
    machine.start()
    machine.wait_for_unit("app-ntfy-port.service")
    machine.wait_for_unit("app-ntfy-socket.service")
    http = "curl -fsS http://127.0.0.1:2586"
    unix = "curl -fsS --unix-socket /run/ntfy-socket/ntfy.sock http://localhost"
    machine.wait_until_succeeds(f"{http}/v1/health")
    machine.wait_until_succeeds(f"{unix}/v1/health")
    assert "127.0.0.1:2586" in machine.succeed("ss -Hln 'sport = :2586'")
    machine.fail("runuser -u nobody -- " + unix + "/v1/health")
    assert machine.succeed(f"{unix}/private -d rejected -o /dev/null -w '%{{http_code}}' || true") == "403"
    machine.succeed(f"{unix}/up-test -d allowed")
    machine.succeed("runuser -u owner -- env XDG_RUNTIME_DIR=/run/user/1000 ntfy-setup >/dev/null")
    machine.succeed("test $(stat -c %a /home/owner/.config/ntfy/token) = 600")
    machine.succeed("sed 's/^/Authorization: Bearer /' /home/owner/.config/ntfy/token | " +
                    unix + "/private --header @- --data authenticated")
    machine.succeed("runuser -u owner -- env XDG_RUNTIME_DIR=/run/user/1000 ntfy-setup >/dev/null")

    podman = "runuser -u owner -- env XDG_RUNTIME_DIR=/run/user/1000 podman"
    before = machine.succeed(podman + " inspect --format '{{.Image}}' app-ntfy-port").strip()
    current = machine.succeed(podman + " inspect --format '{{.Image}}' app-ntfy-socket").strip()
    assert before != current
    machine.succeed(f"{http}/up-persist -d retained")
    machine.succeed("test -f /srv/ntfy-port/cache.db && test -f /srv/ntfy-socket/user.db")
    machine.succeed("systemctl restart app-ntfy-port.service")
    machine.wait_until_succeeds(f"{http}/v1/health")
    # Query the SQLite cache directly. Anonymous UnifiedPush writers cannot read.
    retained = """sqlite3 /srv/ntfy-port/cache.db "SELECT message FROM messages WHERE topic='up-persist'" | grep -Fx retained"""
    machine.succeed(retained)

    machine.succeed("/run/current-system/specialisation/upgrade/bin/switch-to-configuration test")
    machine.wait_until_succeeds(f"{http}/v1/health")
    assert machine.succeed(podman + " inspect --format '{{.Image}}' app-ntfy-port").strip() == current
    machine.succeed(retained)
  '';
}

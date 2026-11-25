{ pkgs }:

# checks.x86_64-linux.pull-deploy: the pull agent under its real units, with
# a local bare repository standing in for GitHub (docs/deploys.md → Tests).
# Each commit in it is a flake with no inputs whose host "system" builds in
# the VM in a second: the commit's configuration-revision and a
# switch-to-configuration that records the switch and points
# /run/current-system at the booted system's entries plus that revision, as
# activation does. A commit whose marker says `fail` does not build.
# scripts/rebuild and its libraries ride along in every commit, so the
# shared-host rebuild guard is checked against the same host.
let
  inherit (pkgs) lib;
  root = ../../..;

  # The build runs sandboxed, with a static busybox (no references) as its
  # only tool, taken in as a path input.
  flake = pkgs.writeText "flake.nix" ''
    {
      inputs.tools = {
        url = "path:${pkgs.pkgsStatic.busybox}";
        flake = false;
      };
      outputs = { self, tools }: {
        nixosConfigurations.machine.config.system.build.toplevel = derivation {
          name = "fake-system";
          system = "x86_64-linux";
          builder = "''${tools}/bin/busybox";
          PATH = "''${tools}/bin";
          rev = self.rev or self.dirtyRev or "unknown";
          marker = builtins.readFile ./marker;
          args = [ "sh" "-c" (builtins.readFile ./build.sh) ];
        };
      };
    }
  '';
  # The build writes only the commit's revision and its switch; the switch,
  # run as root, assembles what /run/current-system shows from the booted
  # system's entries.
  build = pkgs.writeText "build.sh" ''
    set -e
    if [ "$marker" = fail ]; then
      echo "this commit does not build" >&2
      exit 1
    fi
    mkdir -p "$out/bin"
    printf %s "$rev" > "$out/configuration-revision"
    cat > "$out/bin/switch-to-configuration" <<EOF
    #!/bin/sh
    set -e
    PATH=/run/booted-system/sw/bin
    echo "$rev \$1" >> /var/lib/test/switched
    system=/run/fake-systems/$rev
    mkdir -p "\$system"
    for entry in /run/booted-system/*; do
      name=\$(basename "\$entry")
      case "\$name" in
        bin | configuration-revision) ;;
        *) ln -sfn "\$(readlink -f "\$entry")" "\$system/\$name" ;;
      esac
    done
    cp "$out/configuration-revision" "\$system/"
    ln -sfn "\$system" /run/current-system
    EOF
    chmod +x "$out/bin/switch-to-configuration"
  '';

  # test-commit <marker>: a commit on the checked-out branch of /srv/work;
  # prints its hash.
  testCommit = pkgs.writeShellApplication {
    name = "test-commit";
    runtimeInputs = [
      pkgs.git
      pkgs.coreutils
      pkgs.nix
    ];
    text = ''
      cd /srv/work
      install -m 0644 ${flake} flake.nix
      install -m 0644 ${build} build.sh
      printf '%s' "$1" > marker
      install -D -m 0755 ${root + "/scripts/rebuild"} scripts/rebuild
      install -D -m 0644 ${root + "/scripts/lib/deploy-guard.sh"} scripts/lib/deploy-guard.sh
      install -D -m 0644 ${root + "/scripts/lib/post-switch.sh"} scripts/lib/post-switch.sh
      # Locked, as every commit of the real repository is: a flake whose
      # lock would change has no self.rev.
      git add -A
      nix flake lock
      git add -A
      git commit --quiet --allow-empty -m "$1"
      git rev-parse HEAD
    '';
  };

  # What a person's rebuild would apply, without the agent: build the
  # checked-out commit of /srv/work and switch to it.
  manualApply = pkgs.writeShellScriptBin "manual-apply" ''
    set -e
    out=$(nix build --no-link --print-out-paths --no-write-lock-file \
      'git+file:///srv/work#nixosConfigurations.machine.config.system.build.toplevel')
    "$out/bin/switch-to-configuration" switch
  '';

  fakeBbSync = pkgs.writeShellScriptBin "bb-plugins-sync" ''
    echo "$(id -un) $HOME" >> /var/lib/test/bb-plugins-sync
  '';
  fakeRestartApp = pkgs.writeShellScriptBin "restart-app" ''
    echo "$*" >> /var/lib/test/restart-app
  '';
in
pkgs.testers.runNixOSTest {
  name = "pull-deploy";

  nodes.machine = {
    imports = [
      ../../options
      ../../nixos/system/applying.nix
      ./default.nix
    ];

    my = {
      hostname = "machine";
      # Two people make it a shared host (marker and lock). bob has no
      # bb-plugins-sync, so the post-switch steps skip him.
      people = [
        "alice"
        "bob"
      ];
      stacks.pull-deploy = {
        enable = true;
        repository = "file:///srv/remote.git";
        # The test polls by hand.
        interval = "1h";
      };
    };
    # Not a commit of the test repository: the agent must hold at it.
    my.revision = "booted-image";

    users.users.alice = {
      isNormalUser = true;
      packages = [ fakeBbSync ];
    };

    nix.settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      substituters = lib.mkForce [ ];
      flake-registry = "";
    };

    # Stand-ins for the post-switch steps' targets.
    systemd.services.tailscale-services = {
      serviceConfig.Type = "oneshot";
      script = "echo restarted >> /var/lib/test/tailscale-services";
    };
    environment.systemPackages = [
      pkgs.git
      fakeRestartApp
      testCommit
      manualApply
    ];

    virtualisation = {
      memorySize = 2048;
      diskSize = 2048;
    };
  };

  testScript = ''
    def sh(cmd):
        return machine.succeed(cmd).strip()

    def applied():
        return sh("cat /run/current-system/configuration-revision")

    def push(rev, *branches):
        for b in branches:
            sh(f"git -C /srv/work push --quiet --force /srv/remote.git {rev}:refs/heads/{b}")

    def switches():
        return sh("cat /var/lib/test/switched 2>/dev/null || true").splitlines()

    def count(name):
        return int(sh(f"if [ -e /var/lib/test/{name} ]; then wc -l < /var/lib/test/{name}; else echo 0; fi"))

    def poll_and_settle():
        """Run one poll and wait until any apply it started has ended."""
        sh("systemctl start pull-deploy-poll.service")
        # The poll queues the apply (--no-block) before it ends: wait for
        # that job, then for the apply to end.
        machine.wait_until_succeeds(
            "[ -z \"$(systemctl list-jobs --no-legend pull-deploy.service)\" ]"
            " && [ \"$(systemctl show -p ActiveState --value pull-deploy.service)\" != activating ]"
        )

    def invocation():
        return sh("systemctl show -p InvocationID --value pull-deploy.service")

    machine.wait_for_unit("multi-user.target")
    # The test polls by hand.
    sh("systemctl stop pull-deploy-poll.timer")
    # bb-plugins-sync writes here as alice.
    sh("mkdir -p /var/lib/test /srv/work && chmod 1777 /var/lib/test")
    sh("git init --quiet --bare /srv/remote.git")
    sh("git -C /srv/work init --quiet -b main")
    sh("git -C /srv/work config user.email t@example.com && git -C /srv/work config user.name t")

    with subtest("the system records the commit it was built from"):
        assert sh("cat /run/booted-system/configuration-revision") == "booted-image"

    c0 = sh("test-commit c0")
    push(c0, "main", "deploy")

    with subtest("a host running a revision deploy does not contain is held, visibly"):
        poll_and_settle()
        sh("systemctl is-failed --quiet pull-deploy.service")
        assert applied() == "booted-image"
        machine.succeed("journalctl -u pull-deploy | grep -q 'pull-deploy: FAILED: holding at booted-image'")
        # The next poll does not start the apply again for the same commit.
        before = invocation()
        poll_and_settle()
        assert invocation() == before, "the apply ran again for a commit it already failed on"
        sh("systemctl is-failed --quiet pull-deploy.service")

    with subtest("a manual apply that catches up clears the failure"):
        sh("manual-apply")
        assert applied() == c0, (applied(), c0)
        poll_and_settle()
        machine.fail("systemctl is-failed --quiet pull-deploy.service")
        machine.fail("test -e /var/lib/pull-deploy/failed")

    with subtest("a new commit on deploy is applied, and the post-switch steps run"):
        c1 = sh("test-commit c1")
        push(c1, "main", "deploy")
        ts = count("tailscale-services")
        poll_and_settle()
        assert applied() == c1, applied()
        assert switches()[-1] == f"{c1} switch", switches()
        assert sh("cat /nix/var/nix/profiles/system/configuration-revision") == c1
        assert count("tailscale-services") == ts + 1, "tailscale-services.service was not restarted"
        assert sh("tail -n1 /var/lib/test/bb-plugins-sync") == "alice /home/alice"
        assert sh("tail -n1 /var/lib/test/restart-app") == "--status"
        machine.succeed(f"journalctl -u pull-deploy | grep -q 'pull-deploy: applied {c1}'")
        machine.fail("systemctl is-failed --quiet pull-deploy.service")

    with subtest("deploy behind what the host runs is never applied"):
        c2 = sh("test-commit c2")
        push(c2, "main")
        # A rebuild from main got ahead of deploy (still c1).
        sh("manual-apply")
        assert applied() == c2, (applied(), c2)
        n = len(switches())
        poll_and_settle()
        # Even started directly, the apply refuses to roll back.
        sh("systemctl start pull-deploy.service")
        # deploy moved backwards (a force push) changes nothing either.
        push(c0, "deploy")
        poll_and_settle()
        sh("systemctl start pull-deploy.service")
        assert applied() == c2, applied()
        assert len(switches()) == n, switches()
        machine.succeed("journalctl -u pull-deploy | grep -q 'Never rolling back'")
        machine.fail("systemctl is-failed --quiet pull-deploy.service")

    with subtest("a commit that does not build leaves the host where it was, and a failed unit"):
        profile = sh("readlink -f /nix/var/nix/profiles/system")
        c3 = sh("test-commit fail")
        push(c3, "main", "deploy")
        poll_and_settle()
        sh("systemctl is-failed --quiet pull-deploy.service")
        assert applied() == c2, applied()
        assert sh("readlink -f /nix/var/nix/profiles/system") == profile
        machine.succeed(f"journalctl -u pull-deploy | grep -q 'pull-deploy: FAILED: the build of {c3} failed'")
        machine.succeed(f"grep -q '^{c3} ' /var/lib/pull-deploy/failed")
        before = invocation()
        poll_and_settle()
        assert invocation() == before, "the apply ran again for a commit it already failed on"
        assert "\nfailed: " in sh("pull-deploy status"), sh("pull-deploy status")

    with subtest("the next good commit goes through and clears the failure"):
        c4 = sh("test-commit c4")
        push(c4, "main", "deploy")
        poll_and_settle()
        assert applied() == c4, applied()
        machine.fail("systemctl is-failed --quiet pull-deploy.service")
        machine.fail("test -e /var/lib/pull-deploy/failed")

    with subtest("pause holds every commit until resume"):
        sh("pull-deploy pause testing a pause")
        assert "\nmode:      paused since" in sh("pull-deploy status"), sh("pull-deploy status")
        c5 = sh("test-commit c5")
        push(c5, "main", "deploy")
        poll_and_settle()
        sh("systemctl start pull-deploy.service")
        assert applied() == c4, applied()
        machine.fail("pull-deploy now")
        sh("pull-deploy resume")
        machine.wait_until_succeeds(f"[ \"$(cat /run/current-system/configuration-revision)\" = {c5} ]")
        poll_and_settle()
        assert "\nmode:      automatic" in sh("pull-deploy status"), sh("pull-deploy status")

    with subtest("status shows what the host runs and what deploy points at"):
        out = sh("su alice -c 'pull-deploy status'")
        print(out)
        assert f"applied:   {c5}" in out, out
        assert f"deploy:    {c5}" in out, out

    with subtest("rebuild on the shared host refuses to roll back what the agent applied"):
        # main behind the applied commit, as when the agent applied a
        # commit after this person fetched.
        push(c4, "main")
        sh("git clone --quiet --branch main /srv/remote.git /srv/clone")
        rebuild = "cd /srv/clone && REBUILD_DRY_RUN=1 scripts/rebuild --no-checks"
        out = machine.fail(rebuild + " 2>&1")
        assert "switching would roll it back" in out, out
        push(c5, "main")
        sh("git -C /srv/clone pull --quiet --ff-only")
        out = sh(rebuild)
        assert "nixos-rebuild switch" in out, out
  '';
}

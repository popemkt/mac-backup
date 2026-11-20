{
  lib,
  pkgs,
  podman,
  systemctl,
}:

# What makes a my.services `image` app a container (../services.nix calls
# this for each one): the start, stop and clean-up commands of its unit
# `app-<name>`, and the compose file that runs the same container under any
# other runtime. Everything else about the unit (owner, restarts, idle
# checks, companions, the Tailscale Service) is the one my.services unit.
#
# The container runs in its owner's rootless Podman, so its root is the
# owner: what it writes to its data directory or its socket is theirs, and
# it holds no privilege on the host the owner does not. Rootless Podman
# keeps its state under /run/user/<uid>, which only a lingering owner has
# without a login, so the module makes every container app's owner linger
# and the unit starts their user manager first (as root, the `+` prefix).
# The unit runs the container the way virtualisation.oci-containers' rootless
# units do (nixpkgs' tests run that): `podman run -d --sdnotify=conmon` under
# Type=notify, conmon as the main process, and `podman stop` and `rm` when
# the unit stops, since the container's processes live in the owner's user
# manager, not in the unit.
#
# Its image is an archive in the store, loaded on every start (layers it
# already has are skipped) and run by the reference it loads as, never
# pulled: a start needs no registry, and the digest it runs is the pin.
let
  inherit (lib) escapeShellArg escapeShellArgs;
in
name: app:
let
  container = "app-${name}";
  containerPort = if app.container.port != null then app.container.port else app.port;
  socketDir = if app.socket != null then dirOf app.socket else null;

  # What `podman run` and the compose file both say, as (host, container)
  # pairs: one meaning, two spellings.
  mounts =
    lib.optional (app.dataDir != null) {
      host = app.dataDir;
      inside = app.container.dataPath;
      bundle = "./data";
      readOnly = false;
    }
    ++ lib.optional (socketDir != null) {
      host = socketDir;
      inside = socketDir;
      bundle = "./run";
      readOnly = false;
    }
    ++ lib.mapAttrsToList (inside: file: {
      host = "${file}";
      inherit inside;
      bundle = "./files${inside}";
      readOnly = true;
    }) app.container.files;
  volume = side: m: "${m.${side}}:${m.inside}${lib.optionalString m.readOnly ":ro"}";
  noNetwork = app.socket != null && !app.container.outbound;
  published = "127.0.0.1:${toString app.port}:${toString containerPort}";

  runArgs = [
    "--name=${container}"
    "--replace"
    "--rm"
    "--detach"
    "--cgroups=enabled"
    "--sdnotify=conmon"
    "--pull=never"
    "--log-driver=journald"
  ]
  ++ lib.optional noNetwork "--network=none"
  ++ lib.optional (app.port != null) "--publish=${published}"
  ++ map (m: "--volume=${volume "host" m}") mounts
  ++ lib.mapAttrsToList (k: v: "--env=${k}=${v}") app.environment;

  # Every command runs as the owner, with rootless Podman's state where an
  # interactive `podman` of theirs finds it, and newuidmap on PATH.
  ctl = pkgs.writeShellScript "app-${name}-container" ''
    set -euo pipefail
    export PATH=/run/wrappers/bin:${
      lib.makeBinPath [
        pkgs.coreutils
        pkgs.gnused
        pkgs.util-linux
      ]
    }:$PATH
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    podman=${podman}/bin/podman
    case "$1" in
      start)
        # Serialize archive loading and reference resolution per owner.
        exec 9>"$XDG_RUNTIME_DIR/app-container-load.lock"
        flock 9
        loaded="$("$podman" load --quiet --input ${app.image} 9>&-)"
        # "Loaded image: <ref>" (or "Loaded image(s): <ref>,<ref>").
        ref="$(sed -n 's/^Loaded image[^:]*: *//p' <<<"$loaded" | head -n 1 | cut -d, -f1)"
        [ -n "$ref" ] || {
          echo "${container}: podman load named no image: $loaded" >&2
          exit 1
        }
        # Keep the lock in this shell only. conmon outlives the start command.
        "$podman" run ${escapeShellArgs runArgs} "$ref" ${escapeShellArgs app.args} 9>&-
        ;;
      stop) exec "$podman" stop --ignore --time 20 ${container} ;;
      remove) exec "$podman" rm --force --ignore ${container} ;;
      *)
        echo "usage: $0 start|stop|remove" >&2
        exit 2
        ;;
    esac
  '';
  # The owner's user manager, which keeps /run/user/<uid>: lingering starts
  # it at boot; this orders the container after it.
  userManager = pkgs.writeShellScript "app-${name}-user-manager" ''
    exec ${systemctl}/bin/systemctl start "user@$(${pkgs.coreutils}/bin/id -u ${escapeShellArg app.owner}).service"
  '';

  # The portable form: docker compose (or podman compose) runs the same image,
  # by digest when the pin has one, with the same files, state and address.
  imageRef = "${app.image.imageName}@${app.image.imageDigest}";
  compose = {
    name = container;
    services.${app.app} = {
      image = imageRef;
      restart = "unless-stopped";
      volumes = map (volume "bundle") mounts;
    }
    // lib.optionalAttrs (app.args != [ ]) { command = app.args; }
    // lib.optionalAttrs (app.environment != { }) { inherit (app) environment; }
    // lib.optionalAttrs noNetwork { network_mode = "none"; }
    // lib.optionalAttrs (app.port != null) { ports = [ published ]; };
  };
  composeFile = (pkgs.formats.yaml { }).generate "compose.yaml" compose;
  bundle = pkgs.runCommand "app-${name}-compose" { } ''
    mkdir -p "$out"
    {
      echo "# my.services.${name} (owner ${app.owner}), portable: the image, files"
      echo "# and address this host runs it with. To move it, copy this directory,"
      echo "# put a copy of ${
        if app.dataDir == null then "its state" else app.dataDir
      } at ./data, and run 'docker compose up -d'"
      echo "# (docs/app-containers.md). Generated; edit my.services.${name} instead."
      cat ${composeFile}
    } >"$out/compose.yaml"
    ${lib.concatMapStrings (m: ''
      mkdir -p "$(dirname "$out/${m.bundle}")"
      cp ${m.host} "$out/${m.bundle}"
    '') (lib.filter (m: m.readOnly) mounts)}
  '';
in
{
  run = "exec ${ctl} start";
  # What the unit was declared to run, without the store paths of the tools
  # that run it (so a nixpkgs bump alone is no definition change).
  declared = {
    image = "${app.image}";
    inherit runArgs;
    inherit (app) args;
  };
  serviceConfig = {
    Type = "notify";
    NotifyAccess = "all";
    Delegate = true;
    ExecStartPre = [ "+${userManager}" ];
    ExecStop = "${ctl} stop";
    ExecStopPost = "${ctl} remove";
    # Loading a large image the first time.
    TimeoutStartSec = 300;
    TimeoutStopSec = 60;
  };
  inherit bundle;
}

{
  pkgs,
  darwinConfigurations,
  nixosConfigurations,
}:
let
  inherit (pkgs) lib;
  channels = import ./channels.nix;
  checkTarget =
    target: declared: effective: scopes:
    lib.concatLists (
      lib.mapAttrsToList (
        name: channel:
        lib.optional (lib.elem (channel.executor or null) scopes) (
          let
            wanted = declared.${name};
            actual = effective.${name} or (throw "${target}/${name}: missing executor view");
            covered =
              if builtins.isList wanted then
                lib.all (member: lib.elem member actual) wanted
              else
                lib.all (key: actual ? ${key} && actual.${key} == wanted.${key}) (lib.attrNames wanted);
          in
          lib.assertMsg (builtins.seq actual covered) "${target}/${name}: executor dropped declared members"
        )
      ) channels
    );
  checkHost =
    platform: hostname: host:
    let
      inherit (host) config;
    in
    checkTarget hostname config.my.pkgs config.my.packageExecutors [ "${platform}System" ]
    ++ lib.concatLists (
      lib.mapAttrsToList (
        username: user:
        checkTarget "${hostname}/${username}" config.my.pkgs user.my.packageExecutors (
          [ "home" ] ++ lib.optional (platform == "darwin") "darwinHome"
        )
      ) config.home-manager.users
    );
  results = lib.concatLists (
    lib.mapAttrsToList (checkHost "darwin") darwinConfigurations
    ++ lib.mapAttrsToList (checkHost "nixos") nixosConfigurations
  );
in
assert lib.all (result: result) results;
pkgs.runCommand "package-executors-contract" { } ''touch "$out"''

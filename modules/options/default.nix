_:

# Option declarations ("the schema" / domain model of this config).
# Each imported file declares options only; hosts and modules define the
# values. channels.nix is plain data that pkgs.nix and mk-stack.nix read.
{
  imports = [
    ./my.nix
    ./people.nix
    ./pkgs.nix
    (import ./package-executors.nix [
      "darwinSystem"
      "nixosSystem"
    ])
    ./services.nix
    ./uv-pins.nix
  ];
}

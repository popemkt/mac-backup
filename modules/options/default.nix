_:

# Option declarations ("the schema" / domain model of this config).
# Each imported file declares options only; hosts and modules define the
# values. channels.nix is plain data that pkgs.nix and mk-stack.nix read.
{
  imports = [
    ./my.nix
    ./pkgs.nix
    ./uv-pins.nix
  ];
}

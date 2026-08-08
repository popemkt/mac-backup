{ lib, ... }:

# Browser-adjacent workspace: unpacked extensions and other browser-side
# assets that live as stable checkouts under /stuff, not in the Nix store.
# Load/enable in each browser profile stays an operator action.
# Enrollment lives in ./system-setup.nix (imported by darwin system-setup).
let
  mkStack = import ../mk-stack.nix lib;
in
{
  options.my.stacks.browsers = mkStack {
    description = "Browser workspace checkouts (unpacked extensions)";
  };
}

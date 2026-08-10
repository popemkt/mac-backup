{ pkgs, ... }:

# Store-packaged kb: one binary, UI baked in. See pkgs/kb.
{
  home.packages = [ pkgs.kb ];
}

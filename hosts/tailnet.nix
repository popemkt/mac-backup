let
  # MagicDNS tailnet identifier shared by service hosts and their clients.
  # Moving to another tailnet is a one-line change here.
  tailnetId = "taild98079";
in
{
  inherit tailnetId;
  cogneeUrl = "https://cognee.${tailnetId}.ts.net";
}

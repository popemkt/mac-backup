{ pkgs, image }:
{
  owner,
  baseUrl,
  socket ? null,
  port ? null,
  expose ? false,
}:
let
  state = "/var/lib/ntfy";
  serverYml = (pkgs.formats.yaml { }).generate "ntfy-server.yml" (
    {
      base-url = baseUrl;
      listen-http = if socket == null then ":${toString port}" else "-";
      behind-proxy = true;
      cache-file = "${state}/cache.db";
      attachment-cache-dir = "${state}/attachments";
      auth-file = "${state}/user.db";
      auth-default-access = "deny-all";
    }
    // pkgs.lib.optionalAttrs (socket != null) { listen-unix = socket; }
  );
in
{
  app = "ntfy";
  inherit
    owner
    image
    socket
    port
    expose
    ;
  args = [ "serve" ];
  container = {
    dataPath = state;
    files."/etc/ntfy/server.yml" = serverYml;
  };
}

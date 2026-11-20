{ pkgs }:
{
  name,
  image,
  dataPath,
}:

# Docker archives produced by dockerTools name their image config in
# manifest.json. Validate the same single image Podman will load before
# either the service or the portable bundle can be built.
pkgs.runCommand "app-${name}-checked-image"
  {
    nativeBuildInputs = [ pkgs.jq ];
    inherit image;
    persistentTarget = if dataPath == null then "" else dataPath;
  }
  ''
    set -o pipefail
    config="$(tar -xOf "$image" manifest.json | jq -er '
      if length == 1 then .[0].Config else error("expected one image") end
      | strings | select(length > 0)
    ')"
    tar -xOf "$image" -- "$config" | jq -e --arg target "$persistentTarget" '
      (.config.Volumes // {}) | keys | map(select($target == "" or . != $target))
      | if length == 0 then true
        else error("image VOLUME " + join(", ") + " has no persistent mapping")
        end
    ' >/dev/null
    ln -s "$image" "$out"
  ''

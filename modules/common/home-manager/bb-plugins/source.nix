# The store copy of a bb plugin kept in this repo: what a rebuild installs,
# taken from the revision being applied. Used by the executor (./default.nix)
# and by the flake check that proves each copy is complete (./check.nix).
#
# A copy holds the plugin folder and every sibling folder its files reach by
# relative path ("../x/…" from its root, "../../x/…" from one level down),
# followed through those siblings too, rooted at their parent so the paths
# hold: context-composer imports types from ../agent-artifacts, kb and
# canvas-links share ../linked-items. Reaching is found by scanning the
# source, so nothing lists it twice; the check catches what the scan misses.
#
# Left out, so that editing them installs nothing: node_modules and dist
# (build output), tests folders, and Markdown other than PLUGIN_OVERVIEW.md
# (bb's store listing) and skills/ (bb loads those).
{ lib }:
let
  skippedDirs = [
    "node_modules"
    "dist"
    "tests"
  ];
  keptFile =
    rel: base:
    !(lib.hasSuffix ".md" base)
    || base == "PLUGIN_OVERVIEW.md"
    || lib.elem "skills" (lib.splitString "/" rel);
  scannedExts = [
    "ts"
    "tsx"
    "mts"
    "js"
    "mjs"
    "json"
    "css"
  ];

  # The files of a folder a copy keeps: [ { path; rel; } ], rel from the folder.
  walk =
    dir: rel:
    lib.concatLists (
      lib.mapAttrsToList (
        n: type:
        let
          path = dir + "/${n}";
          r = if rel == "" then n else "${rel}/${n}";
        in
        if type == "directory" then
          lib.optionals (!lib.elem n skippedDirs) (walk path r)
        else
          lib.optional (keptFile r n) {
            inherit path;
            rel = r;
          }
      ) (builtins.readDir dir)
    );

  # Sibling folders of <parent>/<name> that its files reach by relative path.
  siblingsOf =
    parent: name:
    let
      entries = builtins.readDir parent;
      scanned = lib.filter (
        f: lib.any (e: lib.hasSuffix ".${e}" f.rel) scannedExts && baseNameOf f.rel != "package-lock.json"
      ) (walk (parent + "/${name}") "");
      reached =
        f:
        let
          depth = builtins.length (lib.splitString "/" f.rel) - 1;
          matches = lib.filter builtins.isList (
            builtins.split "((\\.\\./)+)([A-Za-z0-9_@.-]+)" (builtins.readFile f.path)
          );
        in
        map (m: builtins.elemAt m 2) (
          lib.filter (m: builtins.stringLength (builtins.elemAt m 0) == 3 * (depth + 1)) matches
        );
    in
    lib.unique (
      lib.filter (n: n != name && (entries.${n} or null) == "directory") (lib.concatMap reached scanned)
    );

  # The plugin folder and the siblings it reaches, transitively.
  folders =
    parent: name:
    map (x: x.key) (
      builtins.genericClosure {
        startSet = [ { key = name; } ];
        operator = item: map (key: { inherit key; }) (siblingsOf parent item.key);
      }
    );
in
# dir: the plugin folder as a path. Returns the store path; the plugin sits at
# <store path>/<baseNameOf dir>.
dir:
let
  parent = dirOf dir;
  name = builtins.unsafeDiscardStringContext (baseNameOf dir);
  kept = folders parent name;
  prefix = "${toString parent}/";
in
builtins.path {
  name = "bb-plugin-${name}";
  path = parent;
  filter =
    path: type:
    let
      rel = lib.removePrefix prefix (toString path);
      base = baseNameOf rel;
    in
    lib.elem (builtins.head (lib.splitString "/" rel)) kept
    && (if type == "directory" then !(lib.elem base skippedDirs) else keptFile rel base);
}

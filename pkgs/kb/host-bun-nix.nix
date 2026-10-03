# The slice of tools/kb/bun.nix that this host installs.
#
# bun2nix writes one `fetchurl` per locked package, including the optional
# per-platform natives (the Claude Agent SDK's seven foreign CLI binaries,
# esbuild's, tsgo's, ...) that bun itself skips on any other platform. The
# `os`/`cpu` bun uses to skip them live in bun.lock, not in bun.nix, so this
# reads them from bun.lock — the file bun.nix is generated from — and drops
# exactly the entries bun would not install here. No name heuristics, and no
# second list: bun.lock stays the one source of truth.
{ lib, stdenv }:

let
  host = stdenv.hostPlatform.node;

  # bun.lock is JSONC: strip the trailing commas, then it is JSON.
  lock = builtins.fromJSON (
    lib.concatMapStrings (part: if builtins.isList part then builtins.head part else part) (
      builtins.split ",([[:space:]]*[]}])" (builtins.readFile ../../tools/kb/bun.lock)
    )
  );

  # An npm `os`/`cpu` constraint: absent, one name, or a list in which a
  # `!name` entry blocks and any other entry allows.
  allows =
    constraint: current:
    let
      names = lib.toList constraint;
      blocked = builtins.elem "!${current}" names;
      allowed = builtins.filter (name: !(lib.hasPrefix "!" name)) names;
    in
    constraint == null || (!blocked && (allowed == [ ] || builtins.elem current allowed));

  # A registry entry is [ "<name>@<version>", registry, { meta }, integrity ];
  # a workspace member is just [ "<name>@workspace:<path>" ].
  notHere =
    entry:
    let
      meta = builtins.elemAt entry 2;
    in
    builtins.length entry > 2
    && builtins.isAttrs meta
    && !(allows (meta.os or null) host.platform && allows (meta.cpu or null) host.arch);

  foreign = builtins.listToAttrs (
    map (entry: lib.nameValuePair (builtins.head entry) true) (
      builtins.filter notHere (builtins.filter builtins.isList (builtins.attrValues lock.packages))
    )
  );

  bunNix = import ../../tools/kb/bun.nix;
in
# `callPackage` still sees bun.nix's own arguments.
lib.setFunctionArgs (args: lib.filterAttrs (name: _: !(foreign ? ${name})) (bunNix args)) (
  lib.functionArgs bunNix
)

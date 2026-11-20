{ lib, sources }:

# ntfy's container image (binwiederhier/ntfy), pinned by digest in
# nvfetcher.toml for linux/amd64: the image archive my.stacks.ntfy runs as a
# my.services container app (docs/app-containers.md). Not a program to
# install; Linux-only so no Mac builds it.
lib.addMetaAttrs {
  description = "ntfy server container image (${sources.ntfy-image.version})";
  homepage = "https://ntfy.sh";
  license = lib.licenses.asl20;
  platforms = [ "x86_64-linux" ];
} sources.ntfy-image.src

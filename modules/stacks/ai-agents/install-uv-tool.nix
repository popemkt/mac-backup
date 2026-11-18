{ lib, pkgs }:
{
  name,
  version,
  spec,
  python,
  withPackages ? [ ],
  extraCurrent ? "true",
}:
let
  grep = "${pkgs.gnugrep}/bin/grep";
  uv = "${pkgs.uv}/bin/uv";
in
''
  (
    if ! installed="$("${uv}" tool list)"; then
      echo "warning: could not list uv tools; skipping ${name}" >&2
      exit 0
    fi

    if ${grep} -qxF ${lib.escapeShellArg "${name} v${version}"} <<<"$installed" \
      && [[ -x ${lib.escapeShellArg python} ]] \
      && [[ "$(${lib.escapeShellArg python} -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" == "${pkgs.python313.version}" ]] \
      && ( ${extraCurrent}
         ); then
      exit 0
    fi

    # Native wheels built during resolution need Apple's matching SDK and toolchain.
    export SDKROOT="$(/usr/bin/xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
    export PATH="$PATH:/usr/bin:/bin"
    export CC=/usr/bin/clang CXX=/usr/bin/clang++ AR=/usr/bin/ar RANLIB=/usr/bin/ranlib
    export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang
    run "${uv}" tool install --force --python ${pkgs.python313}/bin/python3 \
      ${lib.concatMapStringsSep " " (pkg: "--with ${lib.escapeShellArg pkg}") withPackages} \
      ${lib.escapeShellArg spec} \
      || echo "warning: could not install uv tool ${name}" >&2
  )
''

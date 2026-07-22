{
  callPackage,
  lib,
  python313,
  pyproject-nix,
  pyproject-build-systems,
  runCommand,
  uv2nix,
  includeDev ? false,
}:

let
  workspace = uv2nix.lib.workspace.loadWorkspace {
    workspaceRoot = ../../tools/system-setup;
  };

  projectOverlay = workspace.mkPyprojectOverlay {
    sourcePreference = "wheel";
  };

  pythonSet = (callPackage pyproject-nix.build.packages { python = python313; }).overrideScope (
    lib.composeManyExtensions [
      pyproject-build-systems.overlays.wheel
      projectOverlay
    ]
  );

  environment = pythonSet.mkVirtualEnv "dotfiles-system-setup-0.1.0" (
    if includeDev then workspace.deps.all else workspace.deps.default
  );
in
if includeDev then
  environment
else
  runCommand "dotfiles-system-setup-0.1.0" { } ''
    mkdir -p "$out/bin"
    ln -s ${environment}/bin/system-setup "$out/bin/system-setup"
  ''

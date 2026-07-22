{
  callPackage,
  lib,
  python313,
  pyproject-nix,
  pyproject-build-systems,
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
in
pythonSet.mkVirtualEnv "dotfiles-system-setup-0.1.0" (
  if includeDev then workspace.deps.all else workspace.deps.default
)

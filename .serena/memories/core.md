# Project Core
- Declarative Apple Silicon macOS configuration; repository is source of truth for intentional system behavior, not user/application state.
- `flake.nix` creates `darwinConfigurations` per hostname via `mkDarwin`; host deltas live under `hosts/<hostname>/`.
- `modules/stacks/` is the intent layer for functional slices; each stack owns its options, config, daemons, and package-channel contributions.
- Cross-platform user behavior: `modules/common/home-manager/`; macOS user behavior: `modules/darwin/home-manager/`; macOS system behavior: `modules/darwin/system/`.
- Typed cross-cutting options live in `modules/options/`; system modules use `config.my.*`, Home Manager uses `osConfig.my.*`.
- Run `intent/gate.sh session <harness>` before any work; non-zero requires restoring the Nix environment rather than workarounds.
- Read toolchain details in `mem:tech_stack`, project conventions in `mem:conventions`, daily commands in `mem:suggested_commands`, and completion gates in `mem:task_completion`.
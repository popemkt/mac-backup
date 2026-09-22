# Task Completion
- Format changed Nix: `rtk nixfmt **/*.nix`.
- Static checks: `rtk statix check .` and `rtk scripts/deadnix-repo`.
- Flake evaluation gate: `rtk nix flake check --no-build`.
- Run `rtk rebuild` after changes intended to affect the live system.
- Pre-commit hook under `.githooks/pre-commit` repeats checks for staged files; clone should have `git config core.hooksPath .githooks`.
- Before proposing a commit, inspect `rtk git status` / `rtk git diff` and preserve unrelated user changes.
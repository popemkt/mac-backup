# Technical Stack
- Nix flake targeting `aarch64-darwin`; nix-darwin owns system configuration and Home Manager owns user configuration.
- Homebrew is the executor for Darwin brews/casks; tracked npm and Bun globals are upgraded during `rebuild`.
- Custom packages under `pkgs/` use nvfetcher-managed GitHub release pins in `_sources/` / `nvfetcher.toml`.
- Python-based `tools/system-setup` is checked with Ruff, Pyrefly, and Pytest through the flake.
- Mackup handles backup/restore of mutable application state that should not be modeled declaratively.
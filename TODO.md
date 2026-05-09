# TODO

## Nix patterns to research

Production nix repo shape (study before adopting):

```
flake.nix              # inputs, outputs, hostMap
hosts/<name>/          # per-machine config + hardware
modules/{common,darwin,nixos}/
home/<user>@<host>/
overlays/              # local pkg patches
pkgs/                  # custom packages
secrets/               # encrypted (agenix/sops-nix)
.github/workflows/     # CI: flake check + lint
treefmt.toml           # formatter config
.pre-commit-config.yaml
```

### Real-world repos to read

- https://github.com/Mic92/dotfiles
- https://github.com/Misterio77/nix-config
- https://github.com/srid/nixos-config — uses flake-parts
- https://github.com/cachix/devenv — flake structure at scale
- https://github.com/LnL7/nix-darwin — darwin examples in tree

### Frameworks to evaluate

- **flake-parts** — modular flake outputs, cuts boilerplate when >1 host
- **nixos-unified** — opinionated wrapper over flake-parts
- **home-manager** — already in use, study `mkOutOfStoreSymlink` / overlays
- **agenix** / **sops-nix** — secrets at rest
- **treefmt-nix** — single formatter entry, runs nixfmt + shfmt + prettier
- **pre-commit-hooks.nix** — gate commits, runs statix/deadnix/treefmt
- **devshell** / **flake.devShells** — per-project dev envs

### Tools

- `statix check .` — anti-pattern lint
- `deadnix .` — dead arg / binding finder
- `nixfmt-rfc-style` — official formatter
- `nix flake check` — eval-time validation

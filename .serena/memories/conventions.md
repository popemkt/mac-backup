# Conventions
- Group modules by behavior and ownership boundary, not app count; one-line installs stay in the owning package list.
- Per-stack options live beside the stack and use `mkStack`; import new stacks from `modules/stacks/default.nix`, then enable per host.
- `common` means cross-platform reusable behavior, not automatically applied to every local user.
- Host-specific and work/personal differences stay in host config or the owning system module using `lib.mkIf (config.my.role == "work")`.
- Prefer `_:` over an empty argument pattern; only destructure `pkgs` or other module args when actually referenced.
- Platform branches use `lib.optionals pkgs.stdenv.isDarwin [ ... ]` and `lib.mkIf pkgs.stdenv.isLinux { ... }`.
- Commit subjects follow `<type>: <short description>` with `feat`, `fix`, `docs`, `refactor`, or `chore`.
- Preserve mutable state outside declarative config unless explicitly modeled; consult `docs/backup-strategy.md` for placement decisions.
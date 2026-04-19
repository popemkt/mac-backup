# Agent Notes

Start with the docs in [docs/](/Users/popemkt/.dotfiles/docs) before making structural changes.

Relevant docs:
- [backup-strategy.md](/Users/popemkt/.dotfiles/docs/backup-strategy.md): what should be declarative, what should be backed up as state, and how to decide where new app data belongs
- [nix-concepts.md](/Users/popemkt/.dotfiles/docs/nix-concepts.md): core Nix model for this repo
- [home-manager-options.md](/Users/popemkt/.dotfiles/docs/home-manager-options.md): user-level config patterns
- [nix-darwin-options.md](/Users/popemkt/.dotfiles/docs/nix-darwin-options.md): macOS-specific config patterns
- [troubleshooting.md](/Users/popemkt/.dotfiles/docs/troubleshooting.md): common recovery steps

Working rule:
- Treat this repo as the source of truth for intentional system configuration.
- Treat user data, application state, databases, caches, and agent memory as backup concerns unless explicitly modeled here.

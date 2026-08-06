# Suggested Commands
- Prefix every shell command and every segment of a command chain with `rtk`.
- Apply the current host configuration: `rtk rebuild`.
- Refresh flake inputs then apply: `rtk nix flake update && rtk rebuild`.
- Validate the flake: `rtk nix flake check`.
- Check/verify/update direct GitHub pins: `rtk nix run .#github-sources -- check|verify|update`.
- Back up or restore mutable app state: `rtk mackup backup`, `rtk mackup restore`.
- Prefer RTK-native search/read commands: `rtk find`, `rtk grep`, `rtk read`, `rtk git status`, `rtk git diff`; use `rtk proxy <cmd>` when unfiltered debugging output is required.
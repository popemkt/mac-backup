#!/usr/bin/env bash
set -e

echo "Setting up your Mac..."
echo ""

DOTFILES="$HOME/.dotfiles"

# ============================================================================
# 1. Install Nix
# ============================================================================
if ! command -v nix &>/dev/null; then
  echo "Installing Nix (Determinate Systems installer)..."
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
  echo ""
  echo "Nix installed. Restart your terminal and run this script again."
  exit 0
fi

# ============================================================================
# 2. Install Homebrew
# ============================================================================
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# ============================================================================
# 3. Get hostname and update flake if needed
# ============================================================================
HOSTNAME=$(hostname -s)
echo "Detected hostname: $HOSTNAME"

if ! grep -q "hostname = \"$HOSTNAME\"" "$DOTFILES/flake.nix"; then
  echo ""
  echo "Your hostname '$HOSTNAME' is not the configured flake hostname."
  echo "   Edit ~/.dotfiles/flake.nix and change:"
  echo "     hostname = \"popemkt-mac\";"
  echo "   to:"
  echo "     hostname = \"$HOSTNAME\";"
  echo ""
  read -p "Press Enter after updating, or Ctrl+C to abort..."
fi

# ============================================================================
# 4. Build and apply nix-darwin configuration
# ============================================================================
echo ""
echo "Building nix-darwin configuration..."

# First time: bootstrap nix-darwin
if ! command -v darwin-rebuild &>/dev/null; then
  echo "   (First run - this will take a few minutes...)"
  sudo nix run nix-darwin -- switch --flake "$DOTFILES#$HOSTNAME"
else
  sudo darwin-rebuild switch --flake "$DOTFILES#$HOSTNAME"
fi

# ============================================================================
# 5. Install Mackup
# ============================================================================
if ! command -v mackup &>/dev/null; then
  echo "Installing Mackup..."
  brew install mackup
fi

echo ""
echo "Setup complete."
echo ""
echo "Next steps:"
echo ""
echo "  1. Review your git config:"
echo "     nvim ~/.dotfiles/modules/common/home-manager/git.nix"
echo ""
echo "  2. Review macOS apps and system settings:"
echo "     nvim ~/.dotfiles/modules/darwin/system/default.nix"
echo ""
echo "  3. Apply changes with:"
echo "     rebuild"
echo ""
echo "  4. Restore GUI app configs (if you have backups):"
echo "     mackup restore"
echo ""
echo "  5. Check for untracked casks anytime with:"
echo "     sysaudit"
echo ""

#!/usr/bin/env bash
# Dumps current macOS Login Items to configs/login-items.txt
# Run manually before committing: dump-login-items

DOTFILES="$HOME/.dotfiles"
OUT="$DOTFILES/configs/login-items.txt"

osascript -e 'tell application "System Events" to get the name of every login item' \
  | tr ', ' '\n' \
  | grep -v '^$' \
  | sort > "$OUT"

echo "Login items saved to $OUT"
cat "$OUT"

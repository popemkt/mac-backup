# Run by ./tests.nix: $sync and $activation are the scripts ./default.nix
# builds, for the home $placeholderHome; $repoPlugins is assets/plugins.
set -euo pipefail

H="$PWD/home"
S="$H/.local/state/dotfiles/agent-plugins"
export FAKE="$PWD/fake"
mkdir -p "$H/bin" "$H/.local/bin" "$H/.bun/bin" "$FAKE" \
  "$H/.agents/skills" "$H/.claude/skills" "$H/.codex/skills" "$H/.cursor/skills-cursor"

# The scripts, moved to this home.
sed "s#$placeholderHome#$H#g" "$sync" >"$H/bin/agent-plugins-sync"
sed "s#$placeholderHome#$H#g; s#$sync#$H/bin/agent-plugins-sync#g" "$activation" >"$H/bin/activation"
chmod +x "$H/bin/"*

# claude: marketplaces in $FAKE/mkts.json, installed plugins in
# $FAKE/plugins; fails every call while $FAKE/fail exists, and a marketplace
# add whose source is named in $FAKE/fail-add.
cat >"$H/.local/bin/claude" <<F
#!$shell
echo "claude \$*" >>"\$FAKE/log"
[ -e "\$FAKE/fail" ] && exit 1
case "\$*" in
  "plugin marketplace list --json") cat "\$FAKE/mkts.json" ;;
  "plugin marketplace add "*)
    src="\$4"
    grep -qxF "\$src" "\$FAKE/fail-add" 2>/dev/null && exit 1
    if [ -f "\$src/.claude-plugin/marketplace.json" ]; then
      n="\$($jq -r .name "\$src/.claude-plugin/marketplace.json")"
      entry="{\"name\":\"\$n\",\"source\":\"directory\",\"path\":\"\$src\"}"
    else
      n="\${src#*/}"
      entry="{\"name\":\"\$n\",\"source\":\"github\",\"repo\":\"\$src\"}"
    fi
    $jq --arg n "\$n" --argjson e "\$entry" '[.[] | select(.name != \$n)] + [\$e]' "\$FAKE/mkts.json" >"\$FAKE/m"
    mv "\$FAKE/m" "\$FAKE/mkts.json" ;;
  "plugin list") echo "Installed plugins:"; sed 's/^/  > /' "\$FAKE/plugins" ;;
  "plugin install "*) echo "\$3" >>"\$FAKE/plugins" ;;
  *) echo "fake claude: unexpected \$*" >&2; exit 9 ;;
esac
F
cat >"$H/.local/bin/codex" <<F
#!$shell
echo "codex \$*" >>"\$FAKE/log"
case "\$*" in
  "plugin marketplace list") echo "upstream  owner/upstream" ;;
  "features enable hooks") ;;
  "plugin list") echo "tool@upstream  installed, enabled" ;;
  *) echo "fake codex: unexpected \$*" >&2; exit 9 ;;
esac
F
cat >"$H/.bun/bin/omp" <<F
#!$shell
echo "omp \$*" >>"\$FAKE/log"
F
chmod +x "$H/.local/bin/"* "$H/.bun/bin/omp"

fail() {
  echo "FAIL: $*" >&2
  echo "--- calls" >&2
  cat "$FAKE/log" >&2 || true
  exit 1
}
target() { readlink "$1" 2>/dev/null || echo "(none)"; }
expect_link() { [ "$(target "$1")" = "$2" ] || fail "$1 -> $(target "$1"), expected $2"; }
expect_gone() { [ ! -e "$1" ] && [ ! -L "$1" ] || fail "$1 still exists"; }
called() { grep -qxF "$1" "$FAKE/log" || fail "no call: $1"; }
not_called() { ! grep -qF "$1" "$FAKE/log" || fail "unexpected call: $1"; }
run() {
  : >"$FAKE/log"
  "$@" >"$FAKE/out" 2>&1 || fail "$* exited $?: $(cat "$FAKE/out")"
}

# 1. The state the checkout-based script left: the dotfiles marketplace and
# every skill link in the checkout, plus a skill it no longer has, a skill
# of another tool and a person's own skill folder.
legacy="$H/.dotfiles/assets/plugins"
mkdir -p "$H/.dotfiles/assets"
cp -R "$repoPlugins" "$legacy"
chmod -R u+w "$legacy"
echo "[{\"name\":\"dotfiles\",\"source\":\"directory\",\"path\":\"$legacy\"},{\"name\":\"upstream\",\"source\":\"github\",\"repo\":\"owner/upstream\"}]" >"$FAKE/mkts.json"
printf '%s\n' agent-artifacts@dotfiles tool@upstream >"$FAKE/plugins"
for skill in desktop-computer-use tldraw-conventions gone; do
  ln -s "$legacy/$skill/skills/$skill" "$H/.agents/skills/$skill"
  for dir in .claude/skills .codex/skills .cursor/skills-cursor; do
    ln -s "$H/.agents/skills/$skill" "$H/$dir/$skill"
  done
done
mkdir -p "$H/elsewhere/agent-browser" "$H/.claude/skills/my-own"
ln -s "$H/elsewhere/agent-browser" "$H/.agents/skills/agent-browser"

run "$H/bin/activation"
store="$(target "$S/dotfiles")"
case "$store" in
  "$NIX_STORE"/*-dotfiles-agent-plugins/plugins) ;;
  *) fail "the dotfiles link names $store, not the store copy" ;;
esac
for skill in desktop-computer-use tldraw-conventions; do
  expect_link "$H/.agents/skills/$skill" "$S/dotfiles/$skill/skills/$skill"
  [ -f "$H/.agents/skills/$skill/SKILL.md" ] || fail "$skill does not resolve"
  for dir in .claude/skills .codex/skills .cursor/skills-cursor; do
    expect_link "$H/$dir/$skill" "$H/.agents/skills/$skill"
  done
done
expect_gone "$H/.agents/skills/gone"
expect_gone "$H/.claude/skills/gone"
expect_link "$H/.agents/skills/agent-browser" "$H/elsewhere/agent-browser"
[ -d "$H/.claude/skills/my-own" ] || fail "a person's own skill folder went"
called "claude plugin marketplace add $S/dotfiles"
not_called "marketplace remove"
not_called "plugin install"
called "omp plugin link $S/dotfiles/tldraw-conventions"
[ "$($jq -r '.[] | select(.name == "dotfiles") | .path' "$FAKE/mkts.json")" = "$S/dotfiles" ] \
  || fail "the dotfiles marketplace was not moved to its stable link"

# 2. Nothing to do.
run "$H/bin/activation"
not_called "marketplace add"
not_called "plugin install"
! grep -q "Agent plugins and skills" "$FAKE/out" || fail "an unchanged sync switched the link"

# 3. A --path trial: a worktree that adds a skill and has no
# desktop-computer-use skill.
wt="$H/wt/assets/plugins"
mkdir -p "$H/wt/assets"
cp -R "$legacy" "$wt"
mkdir -p "$wt/tldraw-conventions/skills/trial"
echo trial >"$wt/tldraw-conventions/skills/trial/SKILL.md"
rm -rf "$wt/desktop-computer-use/skills"
run "$H/bin/agent-plugins-sync" --path "$wt"
expect_link "$S/dotfiles" "$wt"
expect_link "$H/.agents/skills/trial" "$S/dotfiles/tldraw-conventions/skills/trial"
expect_link "$H/.codex/skills/trial" "$H/.agents/skills/trial"
expect_gone "$H/.agents/skills/desktop-computer-use"
expect_gone "$H/.claude/skills/desktop-computer-use"
not_called "claude plugin"

# A folder holding a marketplace no stack declares is refused.
other="$H/other"
mkdir -p "$other/.claude-plugin"
echo '{"name":"other"}' >"$other/.claude-plugin/marketplace.json"
if "$H/bin/agent-plugins-sync" --path "$other" 2>/dev/null; then fail "--path took an undeclared marketplace"; fi
if "$H/bin/agent-plugins-sync" --path "$H/elsewhere" 2>/dev/null; then fail "--path took a folder with no marketplace"; fi
expect_link "$S/dotfiles" "$wt"

# 4. The next sync points back at the revision applied.
run "$H/bin/activation"
expect_link "$S/dotfiles" "$store"
expect_gone "$H/.agents/skills/trial"
expect_gone "$H/.codex/skills/trial"
expect_link "$H/.agents/skills/desktop-computer-use" "$S/dotfiles/desktop-computer-use/skills/desktop-computer-use"

# 5. A person's own folder where a link goes, and claude failing: warned,
# activation succeeds, nothing added.
rm "$H/.codex/skills/tldraw-conventions"
mkdir "$H/.codex/skills/tldraw-conventions"
touch "$FAKE/fail"
run "$H/bin/activation"
grep -q "warning: claude plugin marketplace list failed" "$FAKE/out" || fail "no warning for a failed listing"
grep -q "$H/.codex/skills/tldraw-conventions is not a link" "$FAKE/out" || fail "no warning for the folder in the way"
[ -d "$H/.codex/skills/tldraw-conventions" ] && [ ! -L "$H/.codex/skills/tldraw-conventions" ] || fail "the folder in the way was replaced"
not_called "marketplace add"
rm "$FAKE/fail"

# 6. One marketplace failing to add still lets the others and the plugin
# installs converge.
echo "[{\"name\":\"dotfiles\",\"source\":\"directory\",\"path\":\"$S/dotfiles\"}]" >"$FAKE/mkts.json"
echo owner/upstream >"$FAKE/fail-add"
: >"$FAKE/plugins"
run "$H/bin/activation"
grep -q "warning: failed to add Claude Code marketplace upstream" "$FAKE/out" || fail "no warning for the failed add"
called "claude plugin install agent-artifacts@dotfiles"
rm "$FAKE/fail-add"

# 7. A stable link no stack declares any more goes, with its skills' links.
mkdir -p "$H/retired/x/skills/old"
ln -s "$H/retired" "$S/retired"
ln -s "$S/retired/x/skills/old" "$H/.agents/skills/old"
ln -s "$H/.agents/skills/old" "$H/.claude/skills/old"
run "$H/bin/agent-plugins-sync"
expect_gone "$S/retired"
expect_gone "$H/.agents/skills/old"
expect_gone "$H/.claude/skills/old"
expect_link "$S/dotfiles" "$store"

echo "agent-plugins: all checks passed"

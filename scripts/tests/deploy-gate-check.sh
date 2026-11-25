#!/usr/bin/env bash
# deploy-gate against a temporary bare repository standing in for GitHub and
# a gh that answers the runs API from fixtures (gh-runs-stub.sh).
# Usage: deploy-gate-check.sh <scripts/deploy-gate> <gh stub>
# Both run under the bash on PATH (the build sandbox has no /usr/bin/env).
set -euo pipefail

gate_script="$1"
stub_script="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export HOME="$work/home" GITHUB_REPOSITORY=example/dotfiles STUB_RUNS="$work/runs"
mkdir -p "$HOME" "$STUB_RUNS" "$work/bin"
printf '#!%s\nexec %q %q "$@"\n' "$(command -v bash)" "$(command -v bash)" "$stub_script" >"$work/bin/gh"
chmod +x "$work/bin/gh"
export PATH="$work/bin:$PATH"
git config --global user.email test@example.com
git config --global user.name test
git config --global init.defaultBranch main

git init --quiet --bare "$work/remote.git"
git clone --quiet "$work/remote.git" "$work/clone" 2>/dev/null
cd "$work/clone"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_id=0
# commit <name>: a commit on main, pushed; prints its hash.
commit() {
  git commit --quiet --allow-empty -m "$1"
  git push --quiet origin HEAD:main
  git rev-parse HEAD
}
# runs <sha> <path>=<status>/<conclusion>...: the runs CI made for <sha>,
# newest last. Event push on main unless the entry ends in @<event>. A run
# of the same workflow and event replaces the earlier one, as a run's state
# changes in place on GitHub.
runs() {
  local sha="$1" entry path state event status conclusion
  shift
  for entry in "$@"; do
    path="${entry%%=*}"
    state="${entry#*=}"
    event=push
    if [[ "$state" == *@* ]]; then
      event="${state#*@}"
      state="${state%@*}"
    fi
    status="${state%/*}"
    conclusion="${state#*/}"
    [[ "$conclusion" == - ]] && conclusion=null || conclusion="\"$conclusion\""
    run_id=$((run_id + 1))
    printf '{"id": %d, "path": ".github/workflows/%s", "head_branch": "main", "event": "%s", "status": "%s", "conclusion": %s}\n' \
      "$run_id" "$path" "$event" "$status" "$conclusion"
  done | jq -s --slurpfile old <(cat "$STUB_RUNS/$sha.json" 2>/dev/null || echo '[]') '
    . as $new
    | [$old[0][] | select(. as $r | $new | all(.path != $r.path or .event != $r.event))] + $new' \
    >"$STUB_RUNS/$sha.json.new"
  mv "$STUB_RUNS/$sha.json.new" "$STUB_RUNS/$sha.json"
}
deploy_at() { git ls-remote "$work/remote.git" refs/heads/deploy | cut -f1; }
gate() { bash "$gate_script" >"$work/out" 2>&1 || { cat "$work/out" >&2; return 1; }; }
expect_deploy() {
  local got
  got="$(deploy_at)"
  [[ "$got" == "$1" ]] || {
    cat "$work/out" >&2
    fail "$2: deploy is at '${got:-none}', expected '${1:-none}'"
  }
}

ok=validate.yml=completed/success

# 1. No deploy branch yet: created at the newest green commit.
a="$(commit a)"
runs "$a" "$ok"
gate
expect_deploy "$a" "the first green commit creates deploy"

# 2. Validate still running on the newest: deploy takes the green one
#    before it, then the newest once it passes.
b="$(commit b)"
runs "$b" "$ok"
c="$(commit c)"
runs "$c" validate.yml=in_progress/-
gate
expect_deploy "$b" "a commit still validating is skipped for the green one before it"
runs "$c" "$ok"
gate
expect_deploy "$c" "a newer green commit moves deploy forward"

# 3. A commit without Validate (one of several pushed at once), a cancelled
#    and a failed Validate are not green.
commit d >/dev/null
e="$(commit e)"
runs "$e" validate.yml=completed/cancelled
f="$(commit f)"
runs "$f" validate.yml=completed/failure
gate
expect_deploy "$c" "commits without a passing Validate are not green"

# 4. A failed policy apply blocks every later commit until a newer policy
#    run succeeds, even ones that do not touch the policy.
g="$(commit g)"
runs "$g" "$ok" tailscale-policy.yml=completed/failure
h="$(commit h)"
runs "$h" "$ok"
gate
expect_deploy "$c" "a failed policy apply holds deploy"
i="$(commit i)"
runs "$i" "$ok" tailscale-policy.yml=completed/success
gate
expect_deploy "$i" "a newer successful policy run settles it"

# 5. A Services sync still running holds deploy; its dispatched policy
#    reapply must pass too.
j="$(commit j)"
runs "$j" "$ok" tailscale-services.yml=in_progress/-
gate
expect_deploy "$i" "a Services sync still running holds deploy"
runs "$j" tailscale-services.yml=completed/success tailscale-policy.yml=queued/-@workflow_dispatch
gate
expect_deploy "$i" "the policy reapply the sync dispatched holds deploy until it ends"
runs "$j" tailscale-policy.yml=completed/success@workflow_dispatch
gate
expect_deploy "$j" "a green sync and reapply release deploy"

# 6. Runs of other branches or of pull requests do not count.
k="$(commit k)"
printf '[{"id": 900, "path": ".github/workflows/validate.yml", "head_branch": "feature", "event": "pull_request", "status": "completed", "conclusion": "success"}]\n' >"$STUB_RUNS/$k.json"
gate
expect_deploy "$j" "a pull request's Validate does not make a main commit green"

# 7. Never backwards: deploy already ahead of every green commit.
runs "$k" "$ok"
l="$(commit l)"
git push --quiet origin "$l:refs/heads/deploy"
gate
expect_deploy "$l" "deploy past every green commit stays put"

# 8. Someone moves deploy further while the gate decides: the gate's push
#    of an older commit is refused, and it does not force it back.
m="$(commit m)"
runs "$m" "$ok"
n="$(commit n)"
printf '#!%s\ngit -C %q push --quiet origin %s:refs/heads/deploy\n' "$(command -v bash)" "$work/clone" "$n" >"$STUB_RUNS/$n.hook"
chmod +x "$STUB_RUNS/$n.hook"
gate || fail "a deploy moved past the target meanwhile is not an error"
expect_deploy "$n" "deploy moved further meanwhile stays where it went"
grep -q "nothing to do" "$work/out" || fail "the refused push is reported"

# 9. An older run still going holds deploy even though a newer one passed:
#    it could still apply its older state over the newer one.
o="$(commit o)"
runs "$o" "$ok" tailscale-policy.yml=in_progress/-
p="$(commit p)"
runs "$p" "$ok" tailscale-policy.yml=completed/success
gate
expect_deploy "$n" "an older policy run still going holds deploy"
runs "$o" tailscale-policy.yml=completed/success
gate
expect_deploy "$p" "once it ends, deploy moves"

# 10. deploy with commits main lacks: refuse, change nothing.
git checkout --quiet --detach "$n"
stray="$(git commit --quiet --allow-empty -m stray && git rev-parse HEAD)"
git push --quiet --force origin "$stray:refs/heads/deploy"
git checkout --quiet main
if gate; then
  fail "deploy off main must be an error"
fi
expect_deploy "$stray" "deploy off main is left alone"

echo "deploy-gate-check: all cases passed"

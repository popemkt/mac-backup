#!/usr/bin/env bash
# deploy-gate against a temporary bare repository standing in for GitHub and
# a gh that answers the runs API from fixtures (gh-runs-stub.sh).
# Usage: deploy-gate-check.sh <scripts/deploy-gate> <gh stub> <workflows dir>
# Both run under the bash on PATH (the build sandbox has no /usr/bin/env).
set -euo pipefail

gate_script="$1"
stub_script="$2"
workflows="$3"
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
policy=configs/tailscale/policy.hujson
services=modules/stacks/example.nix
# commit <name> [<path>...]: a commit on main changing each <path>, pushed;
# prints its hash.
commit() {
  local name="$1" path
  shift
  for path in "$@"; do
    mkdir -p "$(dirname "$path")"
    echo "$name" >>"$path"
    git add "$path"
  done
  git commit --quiet --allow-empty -m "$name"
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

# 0. The paths the gate watches are the workflows' own push filters.
for w in tailscale-policy tailscale-services; do
  want="$(yq -r '.on.push.paths[]' "$workflows/$w.yml" | sort)"
  got="$({ bash "$gate_script" --print-watched 2>/dev/null || true; } | awk -F'\t' -v w=".github/workflows/$w.yml" '$1 == w { print $2 }' | sort)"
  [[ -n "$want" && "$want" == "$got" ]] || fail "deploy-gate watches for $w.yml: '$got'; the workflow filters: '$want'"
done

# 0b. A Services sync that created a Service reapplies the policy inside its
#     own run, from its own commit, so the run passing is the gate's evidence
#     for both; and every Tailscale apply on main shares one queue, so an
#     older state never lands after a newer one.
services_yml="$workflows/tailscale-services.yml"
policy_yml="$workflows/tailscale-policy.yml"
[[ "$(yq -r '.jobs.sync.steps[] | select(.uses == "tailscale/gitops-acl-action@v1") | .with.action' "$services_yml")" == apply ]] ||
  fail "tailscale-services.yml must reapply the policy in its own sync job"
if grep -q 'gh workflow run' "$services_yml"; then
  fail "tailscale-services.yml must not dispatch the policy reapply as a separate run"
fi
[[ "$(yq -r '.concurrency.group' "$services_yml")" == tailscale-apply ]] ||
  fail "tailscale-services.yml must queue in the tailscale-apply concurrency group"
[[ "$(yq -r '.concurrency.group' "$policy_yml")" == *"'tailscale-apply'"* ]] ||
  fail "tailscale-policy.yml must queue its main runs in the tailscale-apply concurrency group"
[[ "$(yq -r '.concurrency.cancel-in-progress' "$policy_yml")" != true ]] ||
  fail "tailscale-policy.yml must not cancel a main apply in progress"

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
g="$(commit g "$policy")"
runs "$g" "$ok" tailscale-policy.yml=completed/failure
h="$(commit h)"
runs "$h" "$ok"
gate
expect_deploy "$c" "a failed policy apply holds deploy"
i="$(commit i "$policy")"
runs "$i" "$ok" tailscale-policy.yml=completed/success
gate
expect_deploy "$i" "a newer successful policy run settles it"

# 5. A Services sync still running holds deploy until it passes (it also
#    reapplies the policy when it created a Service, inside the same run).
j="$(commit j "$services")"
runs "$j" "$ok" tailscale-services.yml=in_progress/-
gate
expect_deploy "$i" "a Services sync still running holds deploy"
runs "$j" tailscale-services.yml=completed/success
gate
expect_deploy "$j" "a green sync releases deploy"

# 5b. A change the policy workflow must apply, whose run GitHub does not
#     list yet: no evidence, no deploy.
q="$(commit q "$policy")"
runs "$q" "$ok"
gate
expect_deploy "$j" "a policy change without a listed policy run holds deploy"
runs "$q" tailscale-policy.yml=completed/success
gate
expect_deploy "$q" "its run passing releases deploy"

# 6. Runs of other branches or of pull requests do not count.
k="$(commit k)"
printf '[{"id": 900, "path": ".github/workflows/validate.yml", "head_branch": "feature", "event": "pull_request", "status": "completed", "conclusion": "success"}]\n' >"$STUB_RUNS/$k.json"
gate
expect_deploy "$q" "a pull request's Validate does not make a main commit green"

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
o="$(commit o "$policy")"
runs "$o" "$ok" tailscale-policy.yml=in_progress/-
p="$(commit p "$policy")"
runs "$p" "$ok" tailscale-policy.yml=completed/success
gate
expect_deploy "$n" "an older policy run still going holds deploy"
runs "$o" tailscale-policy.yml=completed/success
gate
expect_deploy "$p" "once it ends, deploy moves"

# 9b. A failed policy apply older than the commits the gate looks at still
#     holds deploy: what must pass comes from every change since deploy.
r="$(commit r "$policy")"
runs "$r" "$ok" tailscale-policy.yml=completed/failure
for x in s t u; do
  sha="$(commit "$x")"
  runs "$sha" "$ok"
done
DEPLOY_GATE_WINDOW=2 gate
expect_deploy "$p" "a failed policy run before the window holds deploy"
v="$(commit v "$policy")"
runs "$v" "$ok" tailscale-policy.yml=completed/success
DEPLOY_GATE_WINDOW=2 gate
expect_deploy "$v" "a later passing policy run releases it"

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

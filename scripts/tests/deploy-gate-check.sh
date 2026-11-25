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

# Run ids, unique across calls (runs' loop is a subshell).
echo 0 >"$work/run-id"
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
# newest last. Event push on main unless the entry has @<event>; a reconcile
# run applied <sha> itself unless the entry ends in +<applied sha>. A run
# of the same workflow and event replaces the earlier one, as a run's state
# changes in place on GitHub (keeping its id and start; a new id starts
# later than every earlier one).
runs() {
  local sha="$1" entry path state event status conclusion applied run_id
  shift
  for entry in "$@"; do
    path="${entry%%=*}"
    state="${entry#*=}"
    applied=null
    if [[ "$state" == *+* ]]; then
      applied="\"${state#*+}\""
      state="${state%+*}"
    fi
    event=push
    if [[ "$state" == *@* ]]; then
      event="${state#*@}"
      state="${state%@*}"
    fi
    status="${state%/*}"
    conclusion="${state#*/}"
    [[ "$conclusion" == - ]] && conclusion=null || conclusion="\"$conclusion\""
    run_id=$(($(cat "$work/run-id") + 1))
    echo "$run_id" >"$work/run-id"
    printf '{"id": %d, "run_started_at": "%s", "path": ".github/workflows/%s", "head_branch": "main", "event": "%s", "status": "%s", "conclusion": %s, "applied": %s}\n' \
      "$run_id" "$(date -u -d "@$run_id" +%FT%TZ)" "$path" "$event" "$status" "$conclusion" "$applied"
  done | jq -s --slurpfile old <(cat "$STUB_RUNS/$sha.json" 2>/dev/null || echo '[]') '
    . as $new
    | [$old[0][] | select(. as $r | $new | all(.path != $r.path or .event != $r.event))]
      + [$new[] | . as $n
         | ([$old[0][] | select(.path == $n.path and .event == $n.event)] | first) as $o
         | if $o then . + {id: $o.id, run_started_at: $o.run_started_at} else . end]' \
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

# 0. The paths the gate watches are the reconcile workflow's own push filter.
[[ -f "$workflows/tailscale-reconcile.yml" ]] || fail "tailscale-reconcile.yml must exist"
want="$(yq -r '.on.push.paths[]' "$workflows/tailscale-reconcile.yml" | sort)"
got="$({ bash "$gate_script" --print-watched 2>/dev/null || true; } | awk -F'\t' '$1 == ".github/workflows/tailscale-reconcile.yml" { print $2 }' | sort)"
[[ -n "$want" && "$want" == "$got" ]] || fail "deploy-gate watches '$got'; the reconcile workflow filters '$want'"
[[ "$(bash "$gate_script" --print-watched | cut -f1 | sort -u)" == .github/workflows/tailscale-reconcile.yml ]] ||
  fail "deploy-gate must watch the reconcile workflow only"

# 0b. One workflow writes Tailscale state from main, and every run of it
#     reconciles the CURRENT main (never its triggering commit, so a late or
#     rerun run cannot write a stale state) and applies the policy after the
#     Services sync, every time. The policy workflow only tests pull requests.
reconcile_yml="$workflows/tailscale-reconcile.yml"
policy_yml="$workflows/tailscale-policy.yml"
[[ -f "$reconcile_yml" ]] || fail "tailscale-reconcile.yml must exist"
[[ "$(yq -r '[.jobs[].steps[] | select(.uses == "actions/checkout@v6") | .with.ref // "none"] | unique | join(",")' "$reconcile_yml")" == main ]] ||
  fail "every checkout in tailscale-reconcile.yml must take the current main"
[[ "$(yq -r '.jobs.sync.steps[-1] | (.uses // "") + " " + (.with.action // "") + " " + (.if // "always")' "$reconcile_yml")" == "tailscale/gitops-acl-action@v1 apply always" ]] ||
  fail "tailscale-reconcile.yml must end every sync by applying the policy, unconditionally"
# shellcheck disable=SC2016 # GitHub expressions, matched literally
[[ "$(yq -r '.jobs.applied | .needs + " " + .name' "$reconcile_yml")" == 'sync applied ${{ needs.sync.outputs.applied }}' &&
  "$(yq -r '.jobs.sync.outputs.applied' "$reconcile_yml")" == '${{ steps.checkout.outputs.applied }}' &&
  "$(yq -r '.jobs.sync.steps[] | select(.id == "checkout") | .run' "$reconcile_yml")" == *'git rev-parse HEAD'* ]] ||
  fail "tailscale-reconcile.yml must name the commit it checked out in an 'applied <sha>' job"
[[ "$(yq -r '.on.push // "none"' "$policy_yml")" == none ]] ||
  fail "tailscale-policy.yml must not run on pushes to main"
if grep -q 'action: apply' "$policy_yml"; then
  fail "tailscale-policy.yml must not apply the policy"
fi
[[ "$(yq -r '.on.workflow_run.workflows | sort | join(",")' "$workflows/deploy.yml")" == "$(yq -r '.name' "$reconcile_yml"),Validate" ]] ||
  fail "deploy.yml must run after Validate and the reconcile workflow"

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

# 4. A failed reconcile blocks every later commit until a newer one
#    succeeds, even ones that do not touch the policy.
g="$(commit g "$policy")"
runs "$g" "$ok" tailscale-reconcile.yml=completed/failure
h="$(commit h)"
runs "$h" "$ok"
gate
expect_deploy "$c" "a failed policy apply holds deploy"
i="$(commit i "$policy")"
runs "$i" "$ok" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$i" "a newer successful policy run settles it"

# 5. A Services sync still running holds deploy until it passes (it also
#    reapplies the policy when it created a Service, inside the same run).
j="$(commit j "$services")"
runs "$j" "$ok" tailscale-reconcile.yml=in_progress/-
gate
expect_deploy "$i" "a Services sync still running holds deploy"
runs "$j" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$j" "a green sync releases deploy"

# 5b. A change the policy workflow must apply, whose run GitHub does not
#     list yet: no evidence, no deploy.
q="$(commit q "$policy")"
runs "$q" "$ok"
gate
expect_deploy "$j" "a policy change without a listed policy run holds deploy"
runs "$q" tailscale-reconcile.yml=completed/success
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
runs "$o" "$ok" tailscale-reconcile.yml=in_progress/-
p="$(commit p "$policy")"
runs "$p" "$ok" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$n" "an older policy run still going holds deploy"
runs "$o" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$p" "once it ends, deploy moves"

# 9b. A failed policy apply older than the commits the gate looks at still
#     holds deploy: what must pass comes from every change since deploy.
r="$(commit r "$policy")"
runs "$r" "$ok" tailscale-reconcile.yml=completed/failure
for x in s t u; do
  sha="$(commit "$x")"
  runs "$sha" "$ok"
done
DEPLOY_GATE_WINDOW=2 gate
expect_deploy "$p" "a failed policy run before the window holds deploy"
v="$(commit v "$policy")"
runs "$v" "$ok" tailscale-reconcile.yml=completed/success
DEPLOY_GATE_WINDOW=2 gate
expect_deploy "$v" "a later passing policy run releases it"

# 11. The Actions API failing for one commit aborts the gate: no evidence
#     read is treated as "no runs", which could hide a run still going.
w="$(commit w "$services")"
runs "$w" "$ok" tailscale-reconcile.yml=in_progress/-
y="$(commit y)"
runs "$y" "$ok" tailscale-reconcile.yml=completed/success@workflow_dispatch
touch "$STUB_RUNS/$w.fail"
if gate; then
  fail "a failed runs API read must fail the gate"
fi
expect_deploy "$v" "a failed runs API read moves nothing"
rm "$STUB_RUNS/$w.fail"
runs "$w" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$y" "once the API answers and the run passed, deploy moves"

# 12. A reconcile run is credited to the commit it checked out, not the one
#     that triggered it: a run on A that applied main at B (a later policy
#     change) is no evidence for A or C; a run that applied C (only a
#     README after A) is.
aa="$(commit aa "$policy")"
cc="$(commit cc README.md)"
bb="$(commit bb "$policy")"
runs "$aa" "$ok" "tailscale-reconcile.yml=completed/success+$bb"
runs "$cc" "$ok"
gate
expect_deploy "$y" "a run that applied a later Tailscale state holds deploy"
grep -q "state of $bb" "$work/out" || fail "the hold names the commit the run applied"
touch "$STUB_RUNS/jobs.fail"
if gate; then
  fail "a failed jobs API read must fail the gate"
fi
rm "$STUB_RUNS/jobs.fail"
touch "$STUB_RUNS/workflow.fail"
if gate; then
  fail "a failed read of the reconcile's runs must fail the gate"
fi
rm "$STUB_RUNS/workflow.fail"
runs "$aa" "tailscale-reconcile.yml=completed/success+$cc"
gate
expect_deploy "$cc" "a run that applied the same Tailscale state releases it"

# 13. The live state is what the newest reconcile wrote, whatever its
#     trigger: D's own reconcile passed, but a later one applied E, which
#     then failed Validate. The tailnet holds E's state, so D is held, until
#     a run applies a commit with D's state or a newer green one.
dd="$(commit dd "$policy")"
runs "$dd" "$ok" tailscale-reconcile.yml=completed/success
ee="$(commit ee "$policy")"
runs "$ee" validate.yml=completed/failure tailscale-reconcile.yml=completed/success
gate
expect_deploy "$cc" "a later reconcile replaced the candidate's state: hold"
grep -q "state of $ee" "$work/out" || fail "the hold names the commit live now"
ff="$(commit ff "$policy")"
runs "$ff" "$ok" tailscale-reconcile.yml=in_progress/-
gate
expect_deploy "$cc" "a reconcile still going holds deploy"
runs "$ff" tailscale-reconcile.yml=completed/success
gate
expect_deploy "$ff" "the newest reconcile applying a green commit releases it"

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

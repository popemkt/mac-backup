# kb-pair [<store>]: a one-use pairing code (valid 10 minutes) for a kb
# store's capture listener, and the URL a phone pairs with
# (modules/stacks/kb/nixos.nix, my.stacks.kb.stores.<name>.capture).
#
# <store> is the name of the store's UI Service, kb-<owner>; without it,
# the one store the caller owns. The code comes from kb's capture.pairCode,
# run as the caller, who must be the store's owner: a code pairs a device
# with someone's store, so nobody issues one for a store not their own.
# GAP [[01M7WTAJDSKJ5H5Q9ES56XG55P]]: an administrator with passwordless
# sudo can still run capture.pairCode as another owner by hand.
#
# Env (set by the package): KB (kb by store path), STORES (a JSON file:
# store → {owner, root, url}).

usage() {
  echo "usage: kb-pair [<store>]   stores: $(jq -r 'keys | join(", ")' "$STORES")" >&2
  exit 2
}

me="$(id -un)"
case "$#:${1:-}" in
  0:)
    mine="$(jq -r --arg me "$me" 'to_entries[] | select(.value.owner == $me) | .key' "$STORES")"
    [ -n "$mine" ] && [ "$(wc -l <<<"$mine")" -eq 1 ] || {
      echo "kb-pair: name a store; $me owns ${mine:-none} with a capture listener." >&2
      usage
    }
    store="$mine"
    ;;
  1:-h | 1:--help) usage ;;
  1:*) store="$1" ;;
  *) usage ;;
esac

entry="$(jq -c --arg s "$store" '.[$s] // empty' "$STORES")"
[ -n "$entry" ] || {
  echo "kb-pair: no store $store with a capture listener." >&2
  usage
}
owner="$(jq -r .owner <<<"$entry")"
root="$(jq -r .root <<<"$entry")"
url="$(jq -r .url <<<"$entry")"
[ "$owner" = "$me" ] || {
  echo "kb-pair: $store is $owner's store; only $owner can pair a device with it." >&2
  exit 1
}

receipt="$("$KB" --root "$root" --json action-invoke '{"id":"capture.pairCode"}')"
jq -e '.status == "succeeded"' >/dev/null <<<"$receipt" || {
  echo "kb-pair: capture.pairCode failed for $store:" >&2
  echo "$receipt" >&2
  exit 1
}

echo "Store: $store"
echo "URL:   $url"
echo "Code:  $(jq -r .output.code <<<"$receipt")"
echo "Valid once, until $(jq -r .output.expiresAt <<<"$receipt")."

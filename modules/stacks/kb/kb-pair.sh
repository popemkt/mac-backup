# kb-pair [<store>]: a one-use pairing code (valid 10 minutes) for a kb
# store's capture listener, and the URL a phone pairs with
# (modules/stacks/kb/nixos.nix, my.stacks.kb.stores.<name>.capture).
#
# <store> is the name of the store's UI Service, kb-<owner>; without it,
# the one store the caller owns. The code comes from kb's capture.pairCode,
# run as the store's owner (through sudo when that is someone else).
#
# Env (set by the package): KB (kb by store path), SUDO, STORES (a JSON file:
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

# The owner may not be able to enter the caller's directory.
cd /
invoke=("$KB" --root "$root" --json action-invoke '{"id":"capture.pairCode"}')
if [ "$owner" = "$me" ]; then
  receipt="$("${invoke[@]}")"
else
  receipt="$("$SUDO" -u "$owner" -H -- "${invoke[@]}")"
fi
jq -e '.status == "succeeded"' >/dev/null <<<"$receipt" || {
  echo "kb-pair: capture.pairCode failed for $store:" >&2
  echo "$receipt" >&2
  exit 1
}

echo "Store: $store"
echo "URL:   $url"
echo "Code:  $(jq -r .output.code <<<"$receipt")"
echo "Valid once, until $(jq -r .output.expiresAt <<<"$receipt")."

#!/usr/bin/env bash
# After a frontend deploy: request every built asset the way a browser's module script does (Origin header,
# compressed) and report any that comes back as the wrong type. That is what a cached SPA fallback page looks like:
# the page renders blank and the console says "Failed to fetch dynamically imported module". Plain curl does not
# send the Origin header and sees the correct file, so this check has to send it.
#
#   scripts/sweep-live-assets.sh            check frontend/dist/assets against https://reflexityram.com
#   scripts/sweep-live-assets.sh --purge    also clear the bad entries from Cloudflare's cache (needs the token file)
#
# Run it after `npm run build` and once the new HTML is live; do not load the live site while the deploy is still
# propagating (that is what caches the bad entry in the first place). Why and how: the 2026-10-05 incident in .ai/STATE.md.
set -euo pipefail
SITE="${SITE:-https://reflexityram.com}"
DIST="${DIST:-$(cd "$(dirname "$0")/.." && pwd)/frontend/dist/assets}"
ZONE_ID="${CF_ZONE_ID:-df0c36229a1fcfa3a133fbb76071e35b}"
TOKEN_FILE="${CF_TOKEN_FILE:-$HOME/.config/reflexity-codex/cloudflare/reflexity-codex-operator.token}"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

# The live page must be THIS build. Asking for hashed files that are not deployed yet makes Cloudflare cache the SPA
# fallback page under their URLs (this script did exactly that on 2026-10-05, before the guard existed), so check the
# page first and refuse to ask for anything else when it names a file that is not in $DIST.
live_refs="$(curl -s "$SITE/" | grep -o '/assets/[A-Za-z0-9_.-]*\.\(js\|css\)' | sort -u || true)"
if [ -z "$live_refs" ]; then
  echo "could not read $SITE, so no assets were requested"
  exit 2
fi
for ref in $live_refs; do
  if [ ! -f "$DIST/$(basename "$ref")" ]; then
    echo "$SITE is not serving the build in $DIST ($ref is not in it): the deploy has not finished, or this is another build."
    echo "No assets were requested. Run this once the new page is live."
    exit 2
  fi
done

bad=()
for path in "$DIST"/*; do
  file="$(basename "$path")"
  case "$file" in
    *.js) want="javascript" ;;
    *.css) want="text/css" ;;
    *) continue ;;
  esac
  type="$(curl -s -o /dev/null -w '%{content_type}' -H 'Accept-Encoding: gzip, deflate, br, zstd' -H "Origin: $SITE" -H 'Accept: */*' "$SITE/assets/$file")"
  case "$type" in *"$want"*) ;; *) bad+=("$file ($type)") ;; esac
done

echo "checked $(find "$DIST" -maxdepth 1 \( -name '*.js' -o -name '*.css' \) | wc -l) assets against $SITE: ${#bad[@]} wrong"
[ "${#bad[@]}" -eq 0 ] && exit 0
printf '  %s\n' "${bad[@]}"
if [ "$PURGE" -ne 1 ]; then
  echo "re-run with --purge to clear them from Cloudflare's cache"
  exit 1
fi

files_json="$(printf '%s\n' "${bad[@]}" | sed 's/ (.*//' | python3 -c "
import json, sys
site = '$SITE'
print(json.dumps({'files': [{'url': f'{site}/assets/{line.strip()}', 'headers': {'Origin': site}} for line in sys.stdin if line.strip()]}))")"
# the token is read inside the command and never printed
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $(tr -d '\n' < "$TOKEN_FILE")" -H 'Content-Type: application/json' --data "$files_json" \
  | python3 -c "import sys, json; d = json.load(sys.stdin); print('purge:', 'ok' if d.get('success') else d.get('errors'))"
echo "wait a few seconds, then run it again to confirm"
exit 1

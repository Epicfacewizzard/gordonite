#!/usr/bin/env bash
# Runs ON THE CASAOS SERVER (sent there by scripts/deploy-casaos.ps1). Usage: casaos-update.sh <short-commit> <sha256-of-tar>
# Same steps as the 2026-10-06 deployment: verify the archive, take a verified backup, tag the running image for
# rollback, build the new image, recreate the existing Compose service (its settings are not changed), then check health.
set -euo pipefail

REV="${1:?short commit}"
WANT_SHA="${2:?sha256 of the archive}"
ROOT=/home/gordon/gordonite
TAR="$ROOT/releases/gordonite-$REV.tar"
DIR="$ROOT/releases/$REV"
COMPOSE="$ROOT/deploy/gordonite-casaos.yml"
URL=http://127.0.0.1:8082

step() { printf '\n== %s\n' "$*"; }

step "1/7 Checking the archive"
GOT_SHA="$(sha256sum "$TAR" | cut -d' ' -f1)"
[ "$GOT_SHA" = "$WANT_SHA" ] || { echo "Archive hash does not match (got $GOT_SHA). Nothing was changed."; exit 1; }
echo "hash ok"
[ -f "$COMPOSE" ] || { echo "Compose file not found: $COMPOSE. Nothing was changed."; exit 1; }

step "2/7 Sudo (enter the server password if asked)"
sudo -v

step "3/7 Taking a verified backup of the live data before anything changes"
curl -sf -X POST "$URL/api/backups" -H 'content-type: application/json' -d '{}' | head -c 400; echo

has_key() { sudo docker inspect gordonite --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -c '^ASSISTANT_TOKEN=' || true; }
KEY_BEFORE="$(has_key)"
echo "assistant key set on the running container: $([ "$KEY_BEFORE" -ge 1 ] && echo yes || echo no)"

step "4/7 Unpacking the release and tagging the running image for rollback"
rm -rf "$DIR" && mkdir -p "$DIR" && tar -xf "$TAR" -C "$DIR"
sudo docker image tag gordonite:0.1.0 "gordonite:rollback-before-$REV"
echo "rollback image: gordonite:rollback-before-$REV"

step "5/7 Building the new image (a few minutes)"
sudo docker build -t "gordonite:$REV" "$DIR"
sudo docker image tag "gordonite:$REV" gordonite:0.1.0

step "6/7 Recreating the service with the existing Compose settings"
sudo docker compose -f "$COMPOSE" up -d --no-build --pull never --force-recreate gordonite

step "7/7 Checking it came up"
for i in $(seq 1 40); do
  if curl -sf "$URL/api/health" >/dev/null; then break; fi
  sleep 2
done
curl -sf "$URL/api/health" || { echo; echo "NOT HEALTHY. Look at: sudo docker logs --tail 50 gordonite"; exit 1; }
echo
printf 'mood API: HTTP %s (200 expected)\n' "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/moods")"
printf 'logo:     HTTP %s (200 expected)\n' "$(curl -s -o /dev/null -w '%{http_code}' "$URL/icon-512.png")"
KEY_AFTER="$(has_key)"
echo "assistant key set after the update: $([ "$KEY_AFTER" -ge 1 ] && echo yes || echo no)"
if [ "$KEY_BEFORE" -ge 1 ] && [ "$KEY_AFTER" -lt 1 ]; then
  echo "WARNING: the assistant key was set before and is missing now. The Compose file does not supply it."
  echo "         Tell Claude; do not retry the update."
fi
sudo docker ps --filter name=gordonite --format 'container: {{.Names}}  {{.Status}}  image {{.Image}}'
echo
echo "Done. Rollback of the app (only if needed; the database is now schema v5, so restore the backup above with it):"
echo "  sudo docker image tag gordonite:rollback-before-$REV gordonite:0.1.0"
echo "  sudo docker compose -f $COMPOSE up -d --no-build --pull never --force-recreate gordonite"

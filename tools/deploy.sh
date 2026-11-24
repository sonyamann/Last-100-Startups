#!/bin/sh
# Deploys the committed state of main to the studio Droplet and restarts the
# app. Builds the page locally (Vite), sends the code with git archive plus
# the built page, installs the systemd units, and restarts. Uncommitted
# changes are not sent. The server's data/ folder (database, board.json) is
# never touched. One-time server setup: see HOSTING.md (private).
#
#   sh tools/deploy.sh
set -eu

APP="/srv/startups/app"

cd "$(dirname "$0")/.."
# The server's SSH address (user@host) comes from STUDIO_HOST, set in the
# environment or in .env, so it stays out of the repo.
HOST="${STUDIO_HOST:-$(sed -n 's/^STUDIO_HOST=//p' .env 2>/dev/null | tail -n 1)}"
[ -n "$HOST" ] || { echo "Set STUDIO_HOST=user@host in .env first." >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  echo "Note: uncommitted changes are not deployed." >&2
fi

tmp=$(mktemp -d) && chmod 755 "$tmp"
trap 'rm -rf "$tmp"' EXIT
git archive HEAD | tar -x -C "$tmp"
# Build the page from the same committed sources.
(cd "$tmp" && ln -s "$OLDPWD/node_modules" node_modules && npx --no-install vite build --config web/vite.config.ts --logLevel warn && rm node_modules)

rsync -rlptz --delete --exclude /data/ "$tmp/" "$HOST:$APP/"
ssh "$HOST" "sudo install -m 644 $APP/deploy/startups.service $APP/deploy/startups-pipeline.service $APP/deploy/startups-pipeline.timer /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl enable --now startups-pipeline.timer >/dev/null 2>&1 \
  && sudo systemctl restart startups && sleep 2 && systemctl is-active startups \
  && curl -fsS -o /dev/null -w 'the page answers %{http_code}\n' http://127.0.0.1:3003/startups/"
echo "Deployed $(git rev-parse --short HEAD)."

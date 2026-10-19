#!/bin/sh
# Boot an ISOLATED IdeaFoundry for the e2e test: copies the Rails app (without storage/DBs) to a temp
# dir, so nothing of your real instance is read or written. Usage: scripts/idea-app-server.sh <idea-app-dir> <work-dir> [port]
# Prints IDEA_* exports on stdout once ready; server keeps running in the foreground until Ctrl-C.
set -e
APP=$(cd "$1" && pwd); WORK=$2; PORT=${3:-3911}
mkdir -p "$WORK/app" "$WORK/kb"; WORK=$(cd "$WORK" && pwd)
rsync -a --delete --exclude storage --exclude log --exclude tmp --exclude .git --exclude node_modules \
  --exclude exports --exclude graphify-out --exclude codedb.snapshot --exclude '*.sqlite3*' "$APP/" "$WORK/app/"
mkdir -p "$WORK/app/storage" "$WORK/app/log" "$WORK/app/tmp"
cd "$WORK/app"
export RAILS_ENV=development
bin/rails db:prepare >/dev/null
KEY=$(KB="$WORK/kb" bin/rails runner '
u = User.first
u.update!(settings: (u.settings || {}).merge("typing_lock" => { "enabled" => false }))
u.update_kb_folders([ENV.fetch("KB")], hide_native: true)
puts ApiKey.generate(user: u, name: "e2e").raw_token' 2>/dev/null | tail -1)
echo "export IDEA_APP_URL=http://localhost:$PORT IDEA_API_KEY=$KEY IDEA_KB_DIR=$WORK/kb IDEA_KB_SOURCE=0"
exec bin/rails server -b 127.0.0.1 -p "$PORT"

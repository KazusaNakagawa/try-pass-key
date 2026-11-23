#!/usr/bin/env bash
# Copies a consistent snapshot of the development DB out of the Docker volume,
# so it can be opened in a desktop DB client.
#
#   bash scripts/db-snapshot.sh [destination]   (default: ~/Downloads/try-pass-key-snapshot.db)
#
# The DB lives in the sqlite_data volume, not on the host (docs/01 §4, D3), and
# runs in WAL mode: copying app.db alone can miss recent writes still in
# app.db-wal. SQLite's .backup writes one consistent file instead.
# The snapshot is a copy at this moment; rerun to see later changes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
repo_root="$(pwd)"

dest="${1:-$HOME/Downloads/try-pass-key-snapshot.db}"
dest_dir="$(dirname "$dest")"
mkdir -p "$dest_dir"
dest_abs="$(cd "$dest_dir" && pwd)/$(basename "$dest")"

# Keep DB files out of the checkout (the repository is public).
case "$dest_abs" in
  "$repo_root"/*)
    echo "db-snapshot: refusing to write inside the repository: $dest_abs" >&2
    exit 1
    ;;
esac

if ! docker compose ps --status running --services | grep -qx server; then
  echo "db-snapshot: the server container is not running (docker compose up -d)" >&2
  exit 1
fi

tmp="/tmp/snapshot-$$.db"
docker compose exec -T server sqlite3 /data/app.db ".backup ${tmp}"
docker compose cp "server:${tmp}" "$dest_abs" >/dev/null
docker compose exec -T server rm -f "$tmp"

echo "db-snapshot: wrote $dest_abs"
docker compose exec -T server sqlite3 /data/app.db \
  "SELECT 'users=' || (SELECT count(*) FROM users) || ' credentials=' || (SELECT count(*) FROM credentials) || ' sessions=' || (SELECT count(*) FROM sessions);"

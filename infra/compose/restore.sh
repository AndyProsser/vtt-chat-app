#!/usr/bin/env bash
# Restores a folder made by ./backup.sh into this Compose bundle, REPLACING the current database and
# uploaded files. Stop and think: run it on a fresh install, or after taking a new backup of what is there.
#
#   ./restore.sh <backup folder> --yes [--with-config]
#
#   --yes          required: you understand the current data is replaced
#   --with-config  also put back the backup's .env and livekit.yaml (needed on a brand-new machine; the
#                  current ones are kept as .env.before-restore and livekit.yaml.before-restore)
set -euo pipefail
cd "$(dirname "$0")"

src=${1:-}
[[ -n $src && -d $src ]] || { sed -n 2,10p "$0"; exit 2; }
shift
yes=0
with_config=0
for a in "$@"; do
  case $a in
    --yes) yes=1 ;;
    --with-config) with_config=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
((yes)) || { echo "This replaces the database and uploaded files. Re-run with --yes to go ahead." >&2; exit 1; }
[[ -s $src/database.sql.gz && -s $src/media.tar.gz ]] || { echo "$src is not a backup made by backup.sh" >&2; exit 1; }
src=$(cd "$src" && pwd)

if ((with_config)); then
  for f in .env livekit.yaml; do
    [[ -f $src/config/$f ]] || continue
    [[ -f $f ]] && cp -p "$f" "$f.before-restore"
    (umask 077; cp "$src/config/$f" "$f")
  done
  echo "Configuration restored (the previous files are kept as *.before-restore)."
fi
[[ -f .env ]] || { echo "no .env: restore with --with-config, or run ./setup.sh first" >&2; exit 1; }

echo "Stopping the services that use the database…"
docker compose up -d --wait postgres valkey >/dev/null 2>&1
docker compose stop backend worker egress >/dev/null 2>&1 || true

echo "Replacing the database…"
docker compose exec -T postgres psql -U vtt -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS vtt WITH (FORCE)" -c "CREATE DATABASE vtt OWNER vtt" >/dev/null
gunzip -c "$src/database.sql.gz" | docker compose exec -T postgres psql -U vtt -d vtt -v ON_ERROR_STOP=1 -q >/dev/null

# The live-chat replay buffer lives in Valkey, not the database. A client that reconnects after the restore
# would otherwise be replayed lines the restored database does not have (found in the 2026-11-13 rehearsal).
# Only the backend's own keys go: LiveKit keeps its room state in the same Valkey. Clients then get a fresh snapshot.
echo "Clearing the live-chat replay buffer…"
docker compose exec -T valkey sh -c 'valkey-cli --scan --pattern "replay:*" | xargs -r valkey-cli del' >/dev/null

echo "Replacing the uploaded files…"
docker compose run --rm --no-deps -T --entrypoint sh media-init -c 'rm -rf /data/media/* /data/media/.[!.]* 2>/dev/null; tar -C /data/media -xz && chown -R 1000:1000 /data/media' < "$src/media.tar.gz"

if [[ -s $src/recordings.tar.gz ]]; then
  echo "Replacing the recorded audio…"
  docker compose --profile records run --rm --no-deps -T --entrypoint sh recordings-init -c 'rm -rf /out/* 2>/dev/null; tar -C /out -xz && chown -R 1001:0 /out' < "$src/recordings.tar.gz"
fi

echo "Starting everything…"
docker compose up -d --wait
echo "Restored from $src. Check: ./vtt-admin status"

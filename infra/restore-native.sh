#!/usr/bin/env bash
# Restores a folder made by infra/backup-native.sh (or the Compose backup.sh, for the data) into a NATIVE
# install, REPLACING the current database and uploaded files. Run it on a fresh install, or after taking a
# new backup of what is there.
#
#   sudo infra/restore-native.sh <backup folder> --yes [--with-config] [--no-services]
#
#   --yes          required: you understand the current data is replaced
#   --with-config  also put back the backup's vtt.env (needed on a brand-new machine; the current one is kept
#                  as vtt.env.before-restore)
#   --no-services  do not stop and start the vtt-* systemd services (for containers and tests)
# VTT_ENV_FILE overrides the env file path (/etc/vtt/vtt.env); VTT_USER the service user (vtt).
set -euo pipefail

ENV_FILE="${VTT_ENV_FILE:-/etc/vtt/vtt.env}"
APP_USER="${VTT_USER:-vtt}"
src=${1:-}
[[ -n $src && -d $src ]] || { sed -n 2,13p "$0" | sed 's/^# \{0,1\}//'; exit 2; }
shift
yes=0 with_config=0 services=1
for a in "$@"; do
  case $a in
    --yes) yes=1 ;;
    --with-config) with_config=1 ;;
    --no-services) services=0 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
((yes)) || { echo "This replaces the database and uploaded files. Re-run with --yes to go ahead." >&2; exit 1; }
[[ -s $src/database.sql.gz && -s $src/media.tar.gz ]] || { echo "$src is not a backup made by backup-native.sh" >&2; exit 1; }
gzip -t "$src/database.sql.gz" || { echo "the database dump in $src is damaged" >&2; exit 1; }
src=$(cd "$src" && pwd)

if ((with_config)); then
  [[ -f $src/config/vtt.env ]] || { echo "this backup has no config/vtt.env" >&2; exit 1; }
  [[ -f $ENV_FILE ]] && cp -p "$ENV_FILE" "$ENV_FILE.before-restore"
  (umask 027; cp "$src/config/vtt.env" "$ENV_FILE")
  if [[ $EUID -eq 0 ]] && getent group "$APP_USER" >/dev/null; then chgrp "$APP_USER" "$ENV_FILE"; fi
  echo "Configuration restored (the previous file is kept as vtt.env.before-restore)."
fi
[[ -r $ENV_FILE ]] || { echo "no $ENV_FILE: restore with --with-config, or run infra/install.sh first" >&2; exit 1; }
env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
db=$(env_value DATABASE_URL)
media=$(env_value MEDIA_DIR)
recordings=$(env_value RECORDINGS_DIR)
[[ -n $db ]] || { echo "DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
command -v psql >/dev/null || { echo "psql not found: install postgresql-client" >&2; exit 1; }

units=(vtt-backend)
systemctl cat vtt-worker >/dev/null 2>&1 && units+=(vtt-worker)
if ((services)); then
  echo "Stopping the services that use the database…"
  systemctl stop "${units[@]}"
fi

echo "Replacing the database…"
# The database's own owner can empty and refill it, so this needs no superuser or CREATEDB right.
psql "$db" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS public CASCADE" -c "CREATE SCHEMA public" >/dev/null
gunzip -c "$src/database.sql.gz" | psql "$db" -v ON_ERROR_STOP=1 -q >/dev/null

restore_dir() { # <label> <dir> <archive>
  [[ -n $2 ]] || { echo "$1: no folder set in $ENV_FILE, skipped" >&2; return 0; }
  echo "Replacing the $1…"
  mkdir -p "$2"
  find "$2" -mindepth 1 -delete
  tar -C "$2" -xzf "$3"
  if [[ $EUID -eq 0 ]] && id "$APP_USER" >/dev/null 2>&1; then chown -R "$APP_USER:$APP_USER" "$2"; fi
}
restore_dir "uploaded files" "$media" "$src/media.tar.gz"
if [[ -s $src/recordings.tar.gz ]]; then restore_dir "recorded audio" "$recordings" "$src/recordings.tar.gz"; fi

if ((services)); then
  echo "Starting everything…"
  systemctl start "${units[@]}"
fi
echo "Restored from $src. Check: vtt-admin status"

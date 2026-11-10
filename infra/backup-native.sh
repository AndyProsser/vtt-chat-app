#!/usr/bin/env bash
# Backs up a NATIVE install (made by infra/install.sh): the database, the uploaded files (handouts, sound
# clips, portraits), and the configuration (/etc/vtt/vtt.env, which holds the secrets). Recorded audio is
# large, so it is only included with --audio (transcripts and summaries are in the database).
#
#   sudo infra/backup-native.sh [--audio] [--to <folder>]       default folder: ./backups
#
# The result is one folder per run, named vtt-backup-<date>-<time>, mode 700 (it holds secrets); copy it
# somewhere other than this machine. Restore with infra/restore-native.sh <that folder>. The folder has the
# same shape as the Compose bundle's backup.sh makes (the config file differs).
#
# The database is read through DATABASE_URL from the env file, so any user who can read it may run this;
# reading the uploads and recordings needs the service user or root, which is why `sudo` is shown.
# VTT_ENV_FILE overrides the env file path (/etc/vtt/vtt.env).
set -euo pipefail

ENV_FILE="${VTT_ENV_FILE:-/etc/vtt/vtt.env}"
audio=0
dest=./backups
while (($#)); do
  case $1 in
    --audio) audio=1 ;;
    --to) shift; dest=${1:?--to needs a folder} ;;
    -h | --help) sed -n 2,14p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

[[ -r $ENV_FILE ]] || { echo "cannot read $ENV_FILE: is this a native install, and are you root?" >&2; exit 1; }
env_value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
db=$(env_value DATABASE_URL)
media=$(env_value MEDIA_DIR)
recordings=$(env_value RECORDINGS_DIR)
[[ -n $db ]] || { echo "DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump not found: install postgresql-client" >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
out="$dest/vtt-backup-$stamp"
umask 077
mkdir -p "$out/config"
echo "Backing up to $out"

echo "  database…"
pg_dump --no-owner "$db" | gzip > "$out/database.sql.gz"
if ! [[ -s $out/database.sql.gz ]] || ! gzip -t "$out/database.sql.gz"; then
  echo "the database dump is empty or damaged; stopping" >&2
  exit 1
fi

echo "  uploaded files…"
if [[ -n $media && -d $media ]]; then
  tar -C "$media" -cz . > "$out/media.tar.gz"
else
  tar -cz -T /dev/null > "$out/media.tar.gz"   # nothing uploaded yet: an empty archive keeps the folder complete
fi

if ((audio)); then
  if [[ -n $recordings && -d $recordings ]]; then
    echo "  recorded audio (this can be large)…"
    tar -C "$recordings" -cz . > "$out/recordings.tar.gz"
  else
    echo "  recorded audio: RECORDINGS_DIR is not set or missing, skipped" >&2
    audio=0
  fi
fi

echo "  configuration (contains secrets)…"
cp "$ENV_FILE" "$out/config/vtt.env"

{
  echo "VTT Chat App backup (native install)"
  echo "made:     $(date -u +%FT%TZ)"
  echo "audio:    $([[ $audio -eq 1 ]] && echo included || echo "not included")"
  echo "contents: database.sql.gz, media.tar.gz$([[ $audio -eq 1 ]] && echo ', recordings.tar.gz'), config/vtt.env"
} > "$out/MANIFEST.txt"
du -sh "$out"/* | sed 's/^/  /'
echo "Done. Keep this folder off this machine; it holds your secrets."

#!/usr/bin/env bash
# Backs up an instance run with this Compose bundle: the database, the uploaded files (handouts, sound
# clips, portraits), and the configuration (.env and livekit.yaml, which hold the secrets). Recorded audio
# is large, so it is only included with --audio (the transcripts and summaries are in the database).
#
#   ./backup.sh [--audio] [--to <folder>]       default folder: ./backups
#
# The result is one folder per run, named vtt-backup-<date>-<time>, mode 700 (it contains secrets); copy it
# somewhere other than this machine. Restore with ./restore.sh <that folder>.
set -euo pipefail
cd "$(dirname "$0")"

audio=0
dest=./backups
while (($#)); do
  case $1 in
    --audio) audio=1 ;;
    --to) shift; dest=${1:?--to needs a folder} ;;
    -h | --help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "unknown option $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done
[[ -f .env ]] || { echo "no .env here: run this from the infra/compose folder of an installed instance" >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
out="$dest/vtt-backup-$stamp"
umask 077
mkdir -p "$out/config"
echo "Backing up to $out"

docker compose up -d --wait postgres >/dev/null
echo "  database…"
docker compose exec -T postgres pg_dump -U vtt -d vtt --no-owner | gzip > "$out/database.sql.gz"
[[ -s $out/database.sql.gz ]] || { echo "the database dump is empty; stopping" >&2; exit 1; }

echo "  uploaded files…"
docker compose run --rm --no-deps -T --entrypoint sh media-init -c 'tar -C /data/media -cz .' > "$out/media.tar.gz"

if ((audio)); then
  echo "  recorded audio (this can be large)…"
  docker compose --profile records run --rm --no-deps -T --entrypoint sh recordings-init -c 'tar -C /out -cz .' > "$out/recordings.tar.gz"
fi

echo "  configuration (contains secrets)…"
cp .env "$out/config/.env"
[[ -f livekit.yaml ]] && cp livekit.yaml "$out/config/livekit.yaml"

{
  echo "VTT Chat App backup"
  echo "made:     $(date -u +%FT%TZ)"
  echo "commit:   $(git -C ../.. rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "audio:    $([[ $audio -eq 1 ]] && echo included || echo "not included")"
  echo "contents: database.sql.gz, media.tar.gz$([[ $audio -eq 1 ]] && echo ', recordings.tar.gz'), config/"
} > "$out/MANIFEST.txt"
du -sh "$out"/* | sed 's/^/  /'
echo "Done. Keep this folder off this machine; it holds your secrets."

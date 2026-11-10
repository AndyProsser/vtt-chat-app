#!/usr/bin/env bash
# The server-restart-mid-recording drill (ROADMAP Stage 9), against a REAL LiveKit server and a REAL
# Egress: a speaker is recorded, the backend "restarts" (a fresh process with no memory of the
# recording), and recovery must stop the egresses that kept running, keep the audio as tracks, close
# the recording and queue processing. Exits non-zero if any of that fails.
#
# Needs: `livekit-server` on PATH, Docker (the livekit/egress image), a Valkey/Redis on
# VALKEY_PORT (default 56379: `docker compose -f infra/dev/compose.yml up -d --wait`), and
# `npm run build` done. Uses its own ports (17880, 17881, 52000-52100, 18080) and Redis db 5, and
# removes everything it starts.
set -euo pipefail
cd "$(dirname "$0")/../.."

VALKEY_PORT="${VALKEY_PORT:-56379}"
KEY=devkey
SECRET=devsecret-devsecret-devsecret-1234
work="$(mktemp -d)"
mkdir -p "$work/rec"
chmod 777 "$work/rec"   # the Egress container writes here as its own user
LK_PID=""
cleanup() {
  [ -z "$LK_PID" ] || kill "$LK_PID" 2>/dev/null || true
  docker stop vtt-drill-egress >/dev/null 2>&1 || true
  # The files were written by the container's user, so remove them the same way.
  docker run --rm --user root -v "$work:$work" --entrypoint rm livekit/egress:v1.15.0 -rf "$work/rec" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

command -v livekit-server >/dev/null || { echo "livekit-server is not on PATH" >&2; exit 1; }
docker image inspect livekit/egress:v1.15.0 >/dev/null 2>&1 || docker pull livekit/egress:v1.15.0 >/dev/null

cat >"$work/livekit.yaml" <<YAML
port: 17880
bind_addresses: ['']
rtc:
  tcp_port: 17881
  port_range_start: 52000
  port_range_end: 52100
  use_external_ip: false
redis:
  address: 127.0.0.1:$VALKEY_PORT
  db: 5
keys:
  $KEY: $SECRET
YAML
cat >"$work/egress.yaml" <<YAML
log_level: info
api_key: $KEY
api_secret: $SECRET
ws_url: ws://127.0.0.1:17880
redis:
  address: 127.0.0.1:$VALKEY_PORT
  db: 5
health_port: 18080
YAML

livekit-server --config "$work/livekit.yaml" >"$work/livekit.log" 2>&1 &
LK_PID=$!
sleep 2
docker run -d --rm --name vtt-drill-egress --network host --cap-add SYS_ADMIN \
  -e EGRESS_CONFIG_BODY="$(cat "$work/egress.yaml")" -v "$work/rec:$work/rec" \
  livekit/egress:v1.15.0 >/dev/null
for _ in $(seq 1 30); do curl -fs localhost:18080 >/dev/null 2>&1 && break; sleep 1; done

node infra/records-smoke/restart-drill.mjs "$work"

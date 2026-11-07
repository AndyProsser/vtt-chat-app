#!/usr/bin/env bash
# Runs the consent flow against a REAL backend: the real rust-sync client and the app's Shell (with
# a fake platform standing in for speakers and tray). Needs Node and a built backend:
#   npm run build -w @vtt-chat-app/backend
#   tauri-client/scripts/consent-live.sh
# The backend runs in memory on a scratch port; nothing is installed or left behind.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-3997}"
API="http://127.0.0.1:$PORT"
J='content-type: application/json'
work="$(mktemp -d)"
trap 'kill "${BACKEND:-}" "${TESTPID:-}" 2>/dev/null || true; rm -rf "$work"' EXIT

PORT=$PORT node backend/dist/index.js >"$work/backend.log" 2>&1 &
BACKEND=$!
for _ in $(seq 1 30); do curl -fs "$API/api/health" >/dev/null 2>&1 && break; sleep 0.3; done

py() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
TOKEN=$(curl -fs -X POST "$API/api/auth/register" -H "$J" \
  -d '{"email":"dm@example.com","displayName":"DM","password":"correct horse battery","acceptedConsentVersion":"1"}' | py 'd["sessionToken"]')
CAMPAIGN=$(curl -fs -X POST "$API/api/campaigns" -H "authorization: Bearer $TOKEN" -H "$J" -d '{"name":"Live"}' | py 'd.get("campaign",d)["id"]')

VTT_LIVE_API=$API VTT_LIVE_TOKEN=$TOKEN VTT_LIVE_CAMPAIGN=$CAMPAIGN \
  cargo test --manifest-path tauri-client/Cargo.toml -p src-tauri live_consent_flow -- --ignored --nocapture >"$work/test.log" 2>&1 &
TESTPID=$!

wait_for() { for _ in $(seq 1 200); do grep -q "$1" "$work/test.log" && return 0; kill -0 "$TESTPID" 2>/dev/null || return 1; sleep 0.3; done; return 1; }
control() { curl -fs -X POST "$API/api/campaigns/$CAMPAIGN/recording" -H "authorization: Bearer $TOKEN" -H "$J" -d "{\"action\":\"$1\"}" >/dev/null; }

wait_for READY || { cat "$work/test.log"; exit 1; }
control start
wait_for RECONNECT-OK || { cat "$work/test.log"; exit 1; }
control stop
wait "$TESTPID" || { cat "$work/test.log"; exit 1; }
grep -E "^(READY|ACKED|RECONNECT-OK|STOPPED-OK)$|test result" "$work/test.log"

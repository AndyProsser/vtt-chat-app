#!/bin/sh
# Start-up wrapper for the Whisper container (compose.yml, and the GPU and compatibility overrides).
#
#   whisper-start.sh run <whisper-server command line...>   fetch the model if it is missing, then become that command
#   whisper-start.sh health                                 the container's health check
#
# Why a wrapper: whisper-server cannot start without its model, and the model is not in the image (it is the
# operator's choice, 190 MB to 1.6 GB). A one-shot "models-init" container used to fetch it before anything else
# started; now the stack comes up at once and the download happens here, in the background of everything else.
#
# The model is WHISPER_MODEL_FILE (a ggml file name) in /models, fetched from WHISPER_MODEL_URL (default: the
# whisper.cpp repository on huggingface.co). A download goes to a .part file, resumes where it stopped, and is
# retried for ever with a growing pause; while an attempt is running the health check passes ("busy, as intended"),
# and between failed attempts it fails, so a broken download shows as "unhealthy" in `vtt-admin ps`.
# Uses curl when the image has it, else python3 (the CUDA image), so one script serves every Whisper image.
set -u

FILE=${WHISPER_MODEL_FILE:?WHISPER_MODEL_FILE is not set}
MODEL=/models/$FILE
URL=${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$FILE}
MARK=/tmp/whisper-model-fetching
PORT=${PORT:-8080}

log() { echo "whisper-start: $*"; }

http_ok() { # http_ok URL: exit 0 when it answers 2xx
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 4 -o /dev/null "$1"
  else
    python3 -c "import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=4)" "$1" 2>/dev/null
  fi
}

fetch() { # fetch URL FILE: download, resuming a partial file
  if command -v curl >/dev/null 2>&1; then
    curl -fL -sS -C - --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 120 -o "$2" "$1"
  else
    python3 - "$1" "$2" <<'PY'
import os, sys, urllib.request
url, path = sys.argv[1], sys.argv[2]
have = os.path.getsize(path) if os.path.exists(path) else 0
request = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
with urllib.request.urlopen(request, timeout=120) as response:
    resumed = response.status == 206
    with open(path, "ab" if resumed else "wb") as out:
        while True:
            block = response.read(1 << 20)
            if not block:
                break
            out.write(block)
PY
  fi
}

case ${1:-} in
  health)
    [ -e "$MARK" ] && exit 0
    http_ok "http://127.0.0.1:$PORT/health"
    exit $?
    ;;
  run) shift ;;
  *)
    echo "usage: $0 run <command...> | $0 health" >&2
    exit 64
    ;;
esac

rm -f "$MARK"
if [ ! -s "$MODEL" ]; then
  # sh as PID 1 ignores SIGTERM unless it is trapped; without this a stop during a download waits out the grace period.
  child=
  trap 'rm -f "$MARK"; [ -n "$child" ] && kill "$child" 2>/dev/null; exit 143' TERM INT
  pause=15
  log "the model $FILE is not here yet; downloading it from $URL"
  while :; do
    : >"$MARK"
    fetch "$URL" "$MODEL.part" &
    child=$!
    # Progress into the container log (vtt-admin logs whisper), every 30 s while the transfer runs.
    while kill -0 "$child" 2>/dev/null; do
      n=0
      while [ $n -lt 30 ] && kill -0 "$child" 2>/dev/null; do sleep 1; n=$((n + 1)); done
      [ -f "$MODEL.part" ] && log "downloaded $(($(wc -c <"$MODEL.part") / 1048576)) MB so far"
    done
    if wait "$child" && [ -s "$MODEL.part" ]; then
      mv "$MODEL.part" "$MODEL"
      rm -f "$MARK"
      log "the model is downloaded"
      break
    fi
    rm -f "$MARK"
    log "the download failed (no route to $URL, or the file name is wrong?); trying again in $pause s"
    sleep "$pause" &
    child=$!
    wait "$child"
    [ "$pause" -lt 300 ] && pause=$((pause * 2))
  done
  trap - TERM INT
fi

exec "$@"

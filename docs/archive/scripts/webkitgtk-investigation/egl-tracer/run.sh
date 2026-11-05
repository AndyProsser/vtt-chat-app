#!/bin/bash
set -euo pipefail

# Runs MiniBrowser under the egl_trace.so LD_PRELOAD shim against the known
# crashing URL (or one passed as $1), logging every eglCreateImageKHR /
# eglDestroyImageKHR / eglMakeCurrent call with thread ID + timestamp to
# EGL_TRACE_LOG. See ../../WEBKITGTK-NVIDIA-EGL-CRASH.md for background.
#
#   ./build.sh   # once
#   ./run.sh "https://www.youtube.com/watch?v=jNQXAC9IVRw"
#   python3 analyze_egl_trace.py /tmp/egl_trace.log
#
# IMPORTANT — WebKitGTK sandbox: the actual crash (signature 2, in the doc)
# happens in WebKitWebProcess, not the UI process. WebKitGTK normally runs
# WebProcess inside a bubblewrap sandbox that does not pass arbitrary
# environment variables through, which would keep LD_PRELOAD from ever
# reaching the process that crashes. This script disables that sandbox via
# WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 so the preload actually lands
# where it needs to. Only do this against the throwaway repro URL below, not
# for general browsing — the sandbox is a real security boundary otherwise.

cd "$(dirname "$0")"

if [[ ! -f egl_trace.so ]]; then
  echo "egl_trace.so not built yet — running build.sh first." >&2
  ./build.sh
fi

URL="${1:-https://www.youtube.com/watch?v=jNQXAC9IVRw}"
LOG="${EGL_TRACE_LOG:-/tmp/egl_trace.log}"
MINIBROWSER="${MINIBROWSER:-/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser}"

rm -f "$LOG"
echo "Logging to $LOG"
echo "Launching: $MINIBROWSER $URL"

LD_PRELOAD="$(pwd)/egl_trace.so" \
EGL_TRACE_LOG="$LOG" \
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  "$MINIBROWSER" "$URL"

echo
echo "MiniBrowser exited. If it crashed, analyze the trace with:"
echo "  python3 analyze_egl_trace.py $LOG"

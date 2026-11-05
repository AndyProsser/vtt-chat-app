#!/bin/bash
set -euo pipefail

# Builds egl_trace.so, the LD_PRELOAD shim in egl_trace.c. Needs EGL dev
# headers (libegl1-mesa-dev / libegl-dev, whichever the distro calls it).
cd "$(dirname "$0")"

if ! pkg-config --exists egl 2>/dev/null; then
  echo "egl.pc not found via pkg-config — trying a plain build against system EGL headers." >&2
fi

gcc -shared -fPIC -O2 -Wall -o egl_trace.so egl_trace.c -ldl -lpthread
echo "Built egl_trace.so"

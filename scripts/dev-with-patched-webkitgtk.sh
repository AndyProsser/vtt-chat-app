#!/usr/bin/env bash
# Runs the normal `npm run dev` stack, but with LD_LIBRARY_PATH pointed at a
# locally-built, patched webkit2gtk-4.1 instead of the system-installed one —
# see docs/WEBKITGTK-NVIDIA-EGL-CRASH.md for the crash this works around and
# DEVELOPING.md, "Building a patched WebKitGTK", for how to build the library
# this script expects (the patch itself is docs/patches/webkitgtk-321683-null-backing-store.patch,
# upstreamed as https://bugs.webkit.org/show_bug.cgi?id=321683).
#
# This does NOT build or fetch anything itself — the patched WebKit checkout
# and build tree deliberately live outside this repo (tens of GB, unrelated
# to this project's own code). Follow DEVELOPING.md first if you don't have
# one yet.
#
# Linux-only, and only useful on NVIDIA + the affected WebKitGTK/driver
# combination described in that doc — irrelevant on macOS/Windows or any
# other GPU.
#
# Override the default path with WEBKIT_PATCHED_LIB_DIR if your build lives
# somewhere else.

set -euo pipefail

WEBKIT_PATCHED_LIB_DIR="${WEBKIT_PATCHED_LIB_DIR:-$HOME/Development/webkitgtk-321683-build/WebKit/WebKitBuild/GTK/Release/lib}"

if [[ ! -e "${WEBKIT_PATCHED_LIB_DIR}/libwebkit2gtk-4.1.so.0" ]]; then
  echo "error: patched libwebkit2gtk-4.1.so.0 not found at:" >&2
  echo "  ${WEBKIT_PATCHED_LIB_DIR}" >&2
  echo "Set WEBKIT_PATCHED_LIB_DIR to override, or (re)build it — see" >&2
  echo "docs/WEBKITGTK-NVIDIA-EGL-CRASH.md, section \"Patch validated locally\"." >&2
  exit 1
fi

echo "Using patched webkit2gtk-4.1 from: ${WEBKIT_PATCHED_LIB_DIR}"
export LD_LIBRARY_PATH="${WEBKIT_PATCHED_LIB_DIR}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npm run dev

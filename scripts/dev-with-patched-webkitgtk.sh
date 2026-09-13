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
# Override the default paths with WEBKIT_PATCHED_LIB_DIR / WEBKIT_PATCHED_BIN_DIR
# if your build lives somewhere else.
#
# WEBKIT_EXEC_PATH matters as much as LD_LIBRARY_PATH here, not just the .so:
# this build's libwebkit2gtk-4.1.so.0 has /usr/local/libexec/webkit2gtk-4.1
# compiled in as where it expects to find its WebKitWebProcess/WebKitGPUProcess/
# WebKitNetworkProcess helpers (a path that doesn't exist on a normal system —
# it's this dev build's default install prefix, never actually installed
# there). Without WEBKIT_EXEC_PATH set, the library falls through to checking
# the directory of the currently-running executable (fine for `MiniBrowser`,
# useless for a Tauri binary living in its own target/ directory) and then
# that nonexistent compiled-in path — so it would silently pair the patched
# *library* with no matching helper processes at all. WEBKIT_EXEC_PATH is
# checked first and makes it use this same build's own helpers instead,
# keeping everything internally consistent (mixing this patched library with
# the system's stock WebKitWebProcess binary is untested and could hit an IPC
# version mismatch, since the two are compiled together as one unit normally).

set -euo pipefail

WEBKIT_PATCHED_LIB_DIR="${WEBKIT_PATCHED_LIB_DIR:-$HOME/Development/webkitgtk-321683-build/WebKit/WebKitBuild/GTK/Release/lib}"
WEBKIT_PATCHED_BIN_DIR="${WEBKIT_PATCHED_BIN_DIR:-$HOME/Development/webkitgtk-321683-build/WebKit/WebKitBuild/GTK/Release/bin}"

if [[ ! -e "${WEBKIT_PATCHED_LIB_DIR}/libwebkit2gtk-4.1.so.0" ]]; then
  echo "error: patched libwebkit2gtk-4.1.so.0 not found at:" >&2
  echo "  ${WEBKIT_PATCHED_LIB_DIR}" >&2
  echo "Set WEBKIT_PATCHED_LIB_DIR to override, or (re)build it — see" >&2
  echo "docs/WEBKITGTK-NVIDIA-EGL-CRASH.md, section \"Patch validated locally\"." >&2
  exit 1
fi

if [[ ! -e "${WEBKIT_PATCHED_BIN_DIR}/WebKitWebProcess" ]]; then
  echo "error: WebKitWebProcess not found at:" >&2
  echo "  ${WEBKIT_PATCHED_BIN_DIR}" >&2
  echo "Set WEBKIT_PATCHED_BIN_DIR to override." >&2
  exit 1
fi

echo "Using patched webkit2gtk-4.1 from: ${WEBKIT_PATCHED_LIB_DIR}"
echo "Using matching WebKitWebProcess/etc. from: ${WEBKIT_PATCHED_BIN_DIR}"
export LD_LIBRARY_PATH="${WEBKIT_PATCHED_LIB_DIR}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export WEBKIT_EXEC_PATH="${WEBKIT_PATCHED_BIN_DIR}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npm run dev

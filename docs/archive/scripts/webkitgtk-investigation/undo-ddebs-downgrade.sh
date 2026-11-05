#!/bin/bash
set -euo pipefail

# Reverts the package downgrade done for docs/WEBKITGTK-NVIDIA-EGL-CRASH.md
# debug-symbol matching. Reads whatever setup-ddebs.sh actually held
# (rather than a hardcoded list) so it stays correct regardless of how many
# packages ended up in the atomic downgrade set, and unholds/upgrades all
# of them back to latest.
#
#   ! bash docs/scripts/undo-ddebs-downgrade.sh
#
# Pass --full to also remove the -dbgsym packages, gdb, the ddebs repo,
# and the dbgsym keyring — a complete cleanup back to pre-investigation
# state. Without --full, the dbgsym packages are left installed (harmless,
# just disk space) in case you need them again.

HELD=($(apt-mark showhold))

if [[ ${#HELD[@]} -eq 0 ]]; then
  echo "Nothing held — nothing to undo."
else
  echo "Unholding and upgrading: ${HELD[*]}"
  sudo apt-mark unhold "${HELD[@]}"
  sudo apt update
  sudo apt install -y --only-upgrade "${HELD[@]}"
  echo "Back on latest:"
  dpkg -l "${HELD[@]}" | tail -n +6
fi

if [[ "${1:-}" == "--full" ]]; then
  echo "--full: removing dbgsym packages, gdb, ddebs repo, and dbgsym keyring..."
  sudo apt remove -y \
    libwebkit2gtk-4.1-0-dbgsym \
    libjavascriptcoregtk-4.1-0-dbgsym \
    libglib2.0-0t64-dbgsym \
    libgstreamer1.0-0-dbgsym \
    libgstreamer-gl1.0-0-dbgsym \
    libgstreamer-plugins-bad1.0-0-dbgsym \
    gdb 2>/dev/null || true
  sudo rm -f /etc/apt/sources.list.d/ddebs.sources /etc/apt/sources.list.d/ddebs.list /etc/apt/sources.list.d/ddebs.list.bak
  sudo apt remove -y ubuntu-dbgsym-keyring 2>/dev/null || true
  sudo apt update
  echo "Full cleanup done."
fi

#!/bin/bash
set -euo pipefail

# Sets up Ubuntu's ddebs (debug symbol) repo and installs debug symbols
# for the exact installed WebKitGTK/GLib/Mesa/GStreamer versions, so a
# gdb backtrace on the crash resolves to real function names instead of
# raw offsets. See docs/WEBKITGTK-NVIDIA-EGL-CRASH.md. Run this yourself
# (needs sudo password):
#
#   ! bash docs/scripts/setup-ddebs.sh
#
# Undo everything this does with docs/scripts/undo-ddebs-downgrade.sh.

RELEASE=$(lsb_release -cs)
echo "Release codename: $RELEASE"

# 1. Import the ddebs signing key (via the ubuntu-dbgsym-keyring package)
sudo apt install -y ubuntu-dbgsym-keyring

# 2. Add the ddebs repo, in deb822 .sources format directly (not legacy
#    one-line .list): apt's legacy->.sources auto-migration on this system
#    has been observed to point Signed-By at the wrong keyring
#    (ubuntu-archive-keyring.gpg instead of ubuntu-dbgsym-keyring.gpg),
#    which fails with "NO_PUBKEY C8CAB6595FDFF622" even though the key is
#    present. Writing .sources ourselves with the correct keyring sidesteps
#    that entirely.
echo "Types: deb
URIs: http://ddebs.ubuntu.com/
Suites: ${RELEASE} ${RELEASE}-updates
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-dbgsym-keyring.gpg" \
  | sudo tee /etc/apt/sources.list.d/ddebs.sources
sudo rm -f /etc/apt/sources.list.d/ddebs.list /etc/apt/sources.list.d/ddebs.list.bak

sudo apt update

# 3. The debug symbols we want (webkit2gtk crash site + everything else on
#    the stack we saw: glib, gstreamer/gstreamer-gl, gstreamer-plugins-bad.
#    NVIDIA's userspace libs aren't debuggable since they're proprietary).
DBG_PKGS=(
  libwebkit2gtk-4.1-0
  libjavascriptcoregtk-4.1-0
  libglib2.0-0t64
  libgstreamer1.0-0
  libgstreamer-gl1.0-0
  libgstreamer-plugins-bad1.0-0
)

# 4. -dbgsym packages are only built for specific point releases, and
#    -security/-updates routinely ships a newer point release than the
#    ddebs mirror has caught up to. Rather than hardcode version numbers
#    (which would go stale), read the exact version each -dbgsym package
#    depends on and compare to what's installed.
#
#    NOTE: always query "pkg:amd64" explicitly, not bare "pkg" — on a
#    system with i386 multiarch enabled (e.g. for Wine/Steam), bare
#    `dpkg-query -W -f='${Version}' pkg` matches both the :amd64 and
#    :i386 copies and concatenates their version strings with no
#    separator (e.g. "2.88.0-12.88.0-1"), which then never string-equals
#    anything and makes every such package look mismatched even when it
#    isn't.
declare -A TARGET_VERSION
MISMATCHED=()
for pkg in "${DBG_PKGS[@]}"; do
  dbg="${pkg}-dbgsym"
  required=$(apt-cache show "$dbg" 2>/dev/null | grep -m1 "^Depends:" | grep -oP "${pkg} \(= \K[^)]+" || true)
  if [[ -z "$required" ]]; then
    echo "WARNING: couldn't determine required version for $dbg — skipping version check, install may fail" >&2
    continue
  fi
  current=$(dpkg-query -W -f='${Version}' "${pkg}:amd64" 2>/dev/null || true)
  if [[ "$current" != "$required" ]]; then
    echo "Version mismatch for $pkg: installed=$current, $dbg wants=$required"
    MISMATCHED+=("$pkg")
    TARGET_VERSION["$pkg"]="$required"
  fi
done

# 5. webkit2gtk/javascriptcoregtk (and similarly gstreamer-plugins-bad) ship
#    as a tightly-coupled family of binary packages with exact `=` version
#    deps on each other (e.g. libwebkit2gtk-4.1-0 <-> libwebkit2gtk-4.1-dev
#    <-> gir1.2-webkit2-4.1). Downgrading just the -dbgsym target package
#    alone fails with "Depends: libjavascriptcoregtk-4.1-0 (= X) but Y is
#    to be installed" because apt can't downgrade one half of a pinned pair.
#    So: expand each mismatched package to also include its installed
#    reverse-dependencies, but only the ones that actually have a build at
#    the exact same target version (this correctly excludes unrelated
#    packages like libedataserverui, which depends on libwebkit2gtk-4.1-0
#    with no version pin and doesn't need to move).
FULL_SET=()
for pkg in "${MISMATCHED[@]}"; do
  required="${TARGET_VERSION[$pkg]}"
  FULL_SET+=("$pkg=$required")
  while read -r rdep; do
    [[ -z "$rdep" ]] && continue
    installed_ver=$(dpkg-query -W -f='${Version}' "${rdep}:amd64" 2>/dev/null || true)
    [[ -z "$installed_ver" ]] && continue
    if apt-cache madison "$rdep" 2>/dev/null | grep -q " $required "; then
      FULL_SET+=("$rdep=$required")
    fi
  done < <(apt-cache rdepends --installed "$pkg" 2>/dev/null | tail -n +2 | sed 's/^ *//' | sort -u)
done
FULL_SET=($(printf "%s\n" "${FULL_SET[@]}" | sort -u))

if [[ ${#FULL_SET[@]} -gt 0 ]]; then
  echo "Downgrading, as one atomic transaction:"
  printf '  %s\n' "${FULL_SET[@]}"
  sudo apt install -y --allow-downgrades "${FULL_SET[@]}"

  HOLD_PKGS=("${FULL_SET[@]%=*}")
  echo "Holding so 'apt upgrade' won't undo this mid-session: ${HOLD_PKGS[*]}"
  sudo apt-mark hold "${HOLD_PKGS[@]}"
  echo "Remember: run docs/scripts/undo-ddebs-downgrade.sh when done — these are security-patched packages, don't leave them held long-term."
fi

# 6. Now install the actual debug symbols (versions should match at this point)
sudo apt install -y "${DBG_PKGS[@]/%/-dbgsym}" gdb

echo ""
echo "Done. Now reproduce the crash and get a resolved backtrace with:"
echo ""
echo "  ulimit -c unlimited"
echo "  /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser 'https://www.youtube.com/watch?v=jNQXAC9IVRw'"
echo "  coredumpctl gdb   # or: gdb -batch -c core.<pid> /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser -ex 'bt 40'"

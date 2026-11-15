#!/usr/bin/env bash
# Sets one release version everywhere it is kept: the desktop app (tauri.conf.json, Cargo workspace + lockfile) and
# every npm package (server, web, shared, app UI, ...), so the app and the server never disagree.
#   tauri-client/scripts/set-version.sh 0.4.6
# Then check with tauri-client/scripts/release-version.sh v0.4.6.
set -euo pipefail

ver="${1:-}"
[[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 X.Y.Z" >&2; exit 2; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

setv() { sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$ver\"/" "$1"; }
for f in "$root/package.json" "$root"/*/package.json "$root/tauri-client/panels-ui/package.json"; do
  [ -f "$f" ] && setv "$f"
done
setv "$root/tauri-client/src-tauri/tauri.conf.json"
sed -i "/^\[workspace.package\]/,/^\[/s/^version = \".*\"/version = \"$ver\"/" "$root/tauri-client/Cargo.toml"
cd "$root/tauri-client"
if ! cargo update --workspace --offline >/dev/null 2>&1; then cargo update --workspace >/dev/null; fi
cd "$root"
npm install --package-lock-only --ignore-scripts >/dev/null 2>&1
"$root/tauri-client/scripts/release-version.sh" "v$ver" >/dev/null && echo "version set to $ver"

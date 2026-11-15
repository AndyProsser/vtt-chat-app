#!/usr/bin/env bash
# Checks that a release tag, tauri.conf.json and the Cargo workspace all name the same version, so a
# build never ships an installer whose name and updater version disagree.
#   tauri-client/scripts/release-version.sh v0.3.0
# With no tag it only checks that the two files agree with each other, which CI runs on every push so
# the versions cannot drift apart between releases.
# Prints the bare version on success; exits 1 with the mismatch on failure.
set -euo pipefail

tag="${1:-}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

conf="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$root/src-tauri/tauri.conf.json" | head -1)"
cargo="$(sed -n '/^\[workspace.package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p}' "$root/Cargo.toml" | head -1)"

want="${tag#v}"
[ -n "$tag" ] || want="$conf"

fail=0
if [ "$conf" != "$want" ]; then
  echo "tauri.conf.json says $conf but the tag says $want" >&2
  fail=1
fi
if [ "$cargo" != "$want" ]; then
  echo "tauri-client/Cargo.toml says ${cargo:-<none>} but the tag says $want" >&2
  fail=1
fi
# The npm packages (server, web, app UI, ...) carry the same version, so a server run outside an image reports it too.
repo="$(cd "$root/.." && pwd)"
for pkg in "$repo/package.json" "$repo"/*/package.json "$repo/tauri-client/panels-ui/package.json"; do
  [ -f "$pkg" ] || continue
  v="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg" | head -1)"
  if [ "$v" != "$want" ]; then
    echo "${pkg#"$repo"/} says ${v:-<none>} but the tag says $want" >&2
    fail=1
  fi
done
[ "$fail" = 0 ] || exit 1
echo "$want"

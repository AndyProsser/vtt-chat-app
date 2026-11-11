#!/usr/bin/env bash
# Writes a version into tauri.conf.json and the Cargo workspace for THIS build only, without committing
# it. Dev builds use it so a tag like v0.4.0-dev.3 needs no "bump the version" commit: the number comes
# from the tag. (A release is the opposite: its version is committed and release-version.sh checks it.)
#   tauri-client/scripts/stamp-version.sh 0.4.0-dev.3
set -euo pipefail

version="${1:?usage: stamp-version.sh <version, e.g. 0.4.0-dev.3>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

edit() { # file, sed expression (written to a temp file so GNU and BSD sed behave the same)
  sed "$2" "$1" > "$1.stamp" && mv "$1.stamp" "$1"
}

edit "$root/src-tauri/tauri.conf.json" "s/^\\([[:space:]]*\"version\":[[:space:]]*\"\\)[^\"]*\\(\".*\\)\$/\\1$version\\2/"
edit "$root/Cargo.toml" "/^\\[workspace.package\\]/,/^\\[/s/^version[[:space:]]*=.*/version = \"$version\"/"
echo "stamped $version"

#!/usr/bin/env bash
# Prints one version's section of CHANGELOG.md (the release notes), without its heading.
#   tauri-client/scripts/changelog-notes.sh 0.3.1
# Exits 1 if there is no section or it is empty, so a release cannot go out without notes.
set -euo pipefail

version="${1:?usage: changelog-notes.sh <version, e.g. 0.3.1>}"
file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/CHANGELOG.md"

notes="$(awk -v v="$version" '
  /^## \[/ { if (on) exit; if (index($0, "## [" v "]") == 1) { on = 1; next } }
  on { print }
' "$file")"

if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no notes for $version: add a \"## [$version] - YYYY-MM-DD\" section before tagging" >&2
  exit 1
fi
printf '%s\n' "$notes"

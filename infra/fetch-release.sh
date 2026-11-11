#!/usr/bin/env bash
# Downloads a release's installers and signatures into a folder, ready for
#   vtt-admin updates publish <folder> --version <x.y.z> --base-url https://play.example.com/updates
# Needs the GitHub CLI (`gh`), signed in with access to the repository.
#   infra/fetch-release.sh v0.3.0 ./release-0.3.0 [owner/repo]
set -euo pipefail

tag="${1:?usage: fetch-release.sh <tag> <folder> [owner/repo]}"
dest="${2:?usage: fetch-release.sh <tag> <folder> [owner/repo]}"
repo="${3:-}"

command -v gh >/dev/null || { echo "install the GitHub CLI (gh) first" >&2; exit 1; }
mkdir -p "$dest"
args=(release download "$tag" --dir "$dest" --clobber)
[ -z "$repo" ] || args+=(--repo "$repo")
for pattern in '*.AppImage' '*-setup.exe' '*.msi' '*.app.tar.gz' '*.sig' '*.deb' '*.rpm' '*.dmg'; do
  args+=(--pattern "$pattern")
done
gh "${args[@]}"

# An installer without its signature is refused by `updates publish`; say so now, not at publish time.
missing=0
for f in "$dest"/*.AppImage "$dest"/*-setup.exe "$dest"/*.msi "$dest"/*.app.tar.gz; do
  [ -e "$f" ] || continue
  [ -e "$f.sig" ] || { echo "no signature beside $(basename "$f")" >&2; missing=1; }
done
[ "$missing" = 0 ] || exit 1
echo "Downloaded to $dest"

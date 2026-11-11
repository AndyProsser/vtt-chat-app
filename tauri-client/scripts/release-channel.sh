#!/usr/bin/env bash
# Which channel a tag belongs to, by its name alone:
#   v0.4.0          -> release   (a finished version; built into a DRAFT release you publish by hand)
#   v0.4.0-dev.2    -> dev       (any -suffix: -dev.N, -rc.N, -beta.N; published at once as a GitHub pre-release)
# Anything else is refused, so a typo cannot publish something half-named.
set -euo pipefail

tag="${1:?usage: release-channel.sh <tag, e.g. v0.4.0 or v0.4.0-dev.1>}"

if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo release
elif [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*$ ]]; then
  echo dev
else
  echo "\"$tag\" is not a version tag: use vMAJOR.MINOR.PATCH for a release or vMAJOR.MINOR.PATCH-dev.N for a dev build" >&2
  exit 1
fi

#!/usr/bin/env bash
# Drop-in for `whisper-cli` that runs whisper.cpp in Docker, for machines without a native build.
# Mounts the directories of the -m / -f / -of paths at the *same absolute paths* inside the
# container, so the arguments records-smoke passes work unchanged.
#
#   node ai/dist/cli/records-smoke.js --whisper-bin infra/records-smoke/whisper-docker.sh ...
#
# WHISPER_IMAGE overrides the image (e.g. ghcr.io/ggml-org/whisper.cpp:main-cuda with WHISPER_GPU=1).
set -euo pipefail
image="${WHISPER_IMAGE:-ghcr.io/ggml-org/whisper.cpp:main}"
mounts=()
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -m | -f | -of) dir="$(dirname "$(realpath -m "${args[i + 1]}")")"; mounts+=(-v "$dir:$dir") ;;
  esac
done
gpu=()
[[ "${WHISPER_GPU:-0}" == 1 ]] && gpu=(--device nvidia.com/gpu=all)
exec docker run --rm "${gpu[@]}" "${mounts[@]}" --entrypoint /app/build/bin/whisper-cli "$image" "${args[@]}"

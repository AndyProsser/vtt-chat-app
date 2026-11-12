# whisper.cpp with CUDA for GPUs the upstream prebuilt image does not cover — used by compose.gpu.yml.
#
# Upstream's ghcr.io/ggml-org/whisper.cpp:main-cuda is built for sm_75/80/86/90 only (CUDA 13, which
# dropped Pascal), so on a GTX 10-series card it dies with "no kernel image is available". This
# builds the same binaries on CUDA 12.4 for the architectures you list.
#
#   docker compose -f compose.yml -f compose.gpu.yml --profile records build whisper   (or, by hand:)
#   docker build -f infra/compose/whisper-cuda.Dockerfile -t vtt-whisper-cuda \
#     --build-arg CUDA_ARCHS="61;75;86;89" infra/compose
#   WHISPER_IMAGE=vtt-whisper-cuda WHISPER_GPU=1 infra/records-smoke/whisper-docker.sh ...   (records smoke)
#
# The compile takes ~30 minutes once; the image is ~5.8 GB. It also carries whisper-idle.py, which
# compose.gpu.yml runs in front of whisper-server so the model leaves VRAM when Whisper is idle.
#
# Common values: 61 = GTX 10xx, 75 = RTX 20xx/GTX 16xx, 86 = RTX 30xx, 89 = RTX 40xx.
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS build
ARG WHISPER_REF=master
ARG CUDA_ARCHS="61;75;86;89"
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_REF} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# No GPU/driver at build time: link against the CUDA driver stub.
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64/stubs
RUN cmake -B build -DGGML_CUDA=1 -DGGML_NATIVE=OFF -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCHS}" \
      -DCMAKE_EXE_LINKER_FLAGS="-Wl,--allow-shlib-undefined" -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j"$(nproc)" --target whisper-cli whisper-server

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin /app/build/bin
COPY --from=build /src/build/src/libwhisper.so* /app/build/bin/
COPY --from=build /src/build/ggml/src /tmp/ggml
RUN find /tmp/ggml -name '*.so*' -exec cp -P {} /app/build/bin/ \; && rm -rf /tmp/ggml
ENV LD_LIBRARY_PATH=/app/build/bin
# Last, so the compile above stays cached: Python (standard library only) for the idle front.
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY whisper-idle.py /app/whisper-idle.py
ENTRYPOINT ["/app/build/bin/whisper-cli"]

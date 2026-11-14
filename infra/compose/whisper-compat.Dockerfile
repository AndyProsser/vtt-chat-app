# whisper.cpp for CPUs without AVX (or with AVX but not AVX2/FMA): used by compose.compat.yml.
#
# Upstream's ghcr.io/ggml-org/whisper.cpp image is compiled for a modern x86-64 CPU and dies at start with "illegal
# instruction" (exit 132) on an older one, for example a 2010 Xeon (Westmere: SSE4.2 but no AVX) or an Ivy Bridge Core
# (AVX but no AVX2). This builds the same server for the baseline x86-64 instruction set, with no AVX/AVX2/FMA, so it runs
# anywhere. It is slower (several times, on a CPU that could have used AVX2) but it works.
#
#   docker build -f infra/compose/whisper-compat.Dockerfile -t vtt-whisper-compat infra/compose
#
# (compose.compat.yml builds and runs it for you.) The compile takes a few minutes once.
FROM ubuntu:24.04 AS build
ARG WHISPER_REF=v1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_REF} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DGGML_NATIVE=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF \
      -DGGML_AVX512=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j"$(nproc)" --target whisper-server

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl ca-certificates && rm -rf /var/lib/apt/lists/*
# whisper-server and its shared libraries (libwhisper, libggml, and the CPU backend) all land in build/bin.
COPY --from=build /src/build/bin /app/build/bin
ENV LD_LIBRARY_PATH=/app/build/bin
ENTRYPOINT ["/app/build/bin/whisper-server"]

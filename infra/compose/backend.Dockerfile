# Backend and records-worker images. Build context is the repository root (see compose.yml).
#   docker build -f infra/compose/backend.Dockerfile --target backend -t vtt-backend .
#   docker build -f infra/compose/backend.Dockerfile --target worker  -t vtt-worker  .
#
# Stages: manifests → build (compile) / deps (production node_modules) → app (everything the two
# images share) → backend | worker. Every workspace's package.json is copied because `npm ci`
# validates the lockfile against all of them, even when installing only some.

FROM node:26-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY ai/package.json ai/
COPY ddb/package.json ddb/
COPY status/package.json status/
COPY web/package.json web/
COPY tauri-client/panels-ui/package.json tauri-client/panels-ui/

FROM manifests AS build
RUN npm ci -w backend -w ai -w ddb -w shared
COPY shared shared
COPY ai ai
COPY ddb ddb
COPY backend backend
RUN npm run build -w shared -w ai -w ddb -w backend

FROM manifests AS web
# The web pages share the chat command parser with the apps, so build `shared` first.
RUN npm ci -w web -w shared
COPY shared shared
RUN npm run build -w shared
COPY web web
RUN npm run build -w web

FROM manifests AS statuspage
RUN npm ci -w status
COPY status status
RUN npm run build -w status

FROM manifests AS deps
RUN npm ci --omit=dev -w backend -w ai -w ddb -w shared && npm cache clean --force

FROM node:26-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/ai/package.json ai/package.json
COPY --from=build /app/ai/dist ai/dist
COPY --from=build /app/ddb/package.json ddb/package.json
COPY --from=build /app/ddb/dist ddb/dist
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
# The shared starter sounds (catalogue.json and the clips), seeded at start-up.
COPY backend/assets backend/assets
# The browser join page (invite → account → app download), served by the backend at /join.
COPY --from=web /app/web/dist web/dist
# The public status page, served at /status.
COPY --from=statuspage /app/status/dist status/dist

FROM app AS worker
# ffmpeg/ffprobe cut each track into speech windows; Whisper and the LLM are separate services.
RUN apk add --no-cache ffmpeg
# Runs as uid 1001, gid 0: the user LiveKit Egress writes the audio files as, so the worker can delete raw audio (the
# purge rules). The image owns /out the same way because Docker gives a new, empty named volume the ownership of the
# image directory it is first mounted on; that replaced a one-shot "chown" container (compose.yml starts Egress after this).
RUN mkdir /out && chown 1001:0 /out
USER 1001:0
CMD ["node", "ai/dist/cli/worker.js"]

FROM app AS backend
# The release version, baked in by CI (--build-arg VTT_VERSION=0.3.2); GET /api/version reports it.
ARG VTT_VERSION=
ENV VTT_VERSION=$VTT_VERSION
# Owned by the user the server runs as: Docker gives a new, empty named volume mounted here the same ownership, so the
# media volume needs no one-shot "chown" container.
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 3000
ENV PORT=3000 WEB_DIR=/app/web/dist STATUS_DIR=/app/status/dist
# Every 2 s while starting, then once a minute, with busybox wget: starting a second Node for each check, every 10 s,
# was the largest single cost on an idle server (compose.yml has the measurements). --start-interval needs Docker 25+.
HEALTHCHECK --interval=60s --timeout=5s --retries=3 --start-period=60s --start-interval=2s \
  CMD wget -q -O /dev/null "http://127.0.0.1:$PORT/api/health"
CMD ["node", "backend/dist/index.js"]

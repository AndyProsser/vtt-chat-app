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
# The browser join page (invite → account → app download), served by the backend at /join.
COPY --from=web /app/web/dist web/dist
# The public status page, served at /status.
COPY --from=statuspage /app/status/dist status/dist

FROM app AS worker
# ffmpeg/ffprobe cut each track into speech windows; Whisper and the LLM are separate services.
RUN apk add --no-cache ffmpeg
USER node
CMD ["node", "ai/dist/cli/worker.js"]

FROM app AS backend
# The release version, baked in by CI (--build-arg VTT_VERSION=0.3.2); GET /api/version reports it.
ARG VTT_VERSION=
ENV VTT_VERSION=$VTT_VERSION
USER node
EXPOSE 3000
ENV PORT=3000 WEB_DIR=/app/web/dist STATUS_DIR=/app/status/dist
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "backend/dist/index.js"]

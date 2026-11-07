# Backend image. Build context is the repository root (see compose.yml).
#   docker build -f infra/compose/backend.Dockerfile -t vtt-backend .
#
# Three stages so the runtime image carries only production dependencies and compiled output.
# Every workspace's package.json is copied because `npm ci` validates the lockfile against all of
# them, even when installing only -w backend.

FROM node:26-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY ddb/package.json ddb/
COPY ai/package.json ai/
COPY status/package.json status/
COPY tauri-client/panels-ui/package.json tauri-client/panels-ui/

FROM manifests AS build
RUN npm ci -w backend -w shared
COPY shared shared
COPY backend backend
RUN npm run build -w shared -w backend

FROM manifests AS deps
RUN npm ci --omit=dev -w backend -w shared && npm cache clean --force

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
USER node
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "backend/dist/index.js"]

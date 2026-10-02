# The API, the reply refine job and the migration runner, in one image (docs/claude/DB-ROLLOUT.md, gap G2).
# Build from the repo root (the API imports ai, db, gate and sender by relative path):
#   docker build -f packages/api/Dockerfile -t omni-api .
# Run:  API          (default command)        PORT, DATABASE_URL, OMNI_* per src/server.mjs
#       refine job   node packages/api/src/jobs/refine.mjs
#       migrations   node packages/db/src/migrate-cli.mjs [--apply | --check-login=omni_api]   (owner login)
# Node 22.12+ (puppeteer and the rest of the repo assume it); the digest pins the exact base.
FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS deps
WORKDIR /app
COPY packages/api/package.json packages/api/package-lock.json packages/api/
COPY packages/db/package.json packages/db/package-lock.json packages/db/
RUN cd packages/api && npm ci --omit=dev --no-audit --no-fund \
 && cd ../db && npm ci --omit=dev --no-audit --no-fund

FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/packages/api/node_modules packages/api/node_modules
COPY --from=deps /app/packages/db/node_modules packages/db/node_modules
COPY packages/api/package.json packages/api/
COPY packages/api/src packages/api/src
COPY packages/ai/src packages/ai/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/gate/src packages/gate/src
COPY packages/sender/src packages/sender/src
USER node
EXPOSE 8080
CMD ["node", "packages/api/src/server.mjs"]

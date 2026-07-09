# syntax=docker/dockerfile:1

##########################################################################
# Stage 1 — build the React/Vite frontend into client/dist
##########################################################################
FROM node:22-alpine AS client-build
WORKDIR /app/client

# Install deps first (better layer caching)
COPY client/package.json client/package-lock.json ./
RUN npm ci

# Build the static frontend
COPY client/ ./
RUN npm run build


##########################################################################
# Stage 2 — install production server dependencies only
##########################################################################
FROM node:22-alpine AS server-deps
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev


##########################################################################
# Stage 3 — lean production runtime
##########################################################################
FROM node:22-alpine AS runtime
ARG APP_VERSION=1.0.0
ENV NODE_ENV=production \
    PORT=5050 \
    DATA_DIR=/data \
    APP_VERSION=${APP_VERSION}

WORKDIR /app

# Server code + its production node_modules
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/

# Built frontend (server.js serves ../client/dist)
COPY --from=client-build /app/client/dist ./client/dist

# Persistent data lives on a mounted volume at /data (see docker-compose /
# render.yaml / fly.toml). Create it and run as the built-in non-root user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 5050
VOLUME ["/data"]

# Container-level health probe (hosts also probe /health over HTTP)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5050)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]

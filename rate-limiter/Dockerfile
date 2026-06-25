# Multi-stage build for the rate-limiter demo server.
# Build stage compiles TypeScript via tsup; the runtime stage ships only the
# built dist/ plus production deps and runs as the built-in non-root `node` user.

# ---- build stage ----
FROM node:24-alpine AS build
WORKDIR /app
# Copy manifests first so the dependency layer caches across source-only changes.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# tsup emits dist/ including dist/demo/server.js and copies dist/lua/*.lua.
RUN npm run build

# ---- runtime stage ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only -> just ioredis (no tsup/tsx/test tooling in the image).
RUN npm ci --omit=dev
# Copy the WHOLE dist so the Redis Lua scripts (dist/lua/*.lua) survive.
COPY --from=build /app/dist ./dist
# Built-in non-root user shipped by the node image.
USER node
EXPOSE 3000
# Node 24 ships global fetch, so no curl/wget is needed in Alpine.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Exec form so node is PID 1; compose `init: true` forwards SIGTERM for graceful shutdown.
CMD ["node", "dist/demo/server.js"]

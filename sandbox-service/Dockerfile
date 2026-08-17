# The management container: an HTTP API in front of the host's Docker daemon.
#
# It creates *sibling* containers through the mounted socket, so the only host
# tooling it needs is the docker CLI. There is no rclone and no setpriv here any
# more — nothing syncs, and ownership work happens in a throwaway provisioner
# container rather than on the host.
FROM oven/bun:1-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

# One runtime dependency (elysia). Resolved at build time: the workspace
# lockfile lives at the repo root and this image builds from its own directory,
# so pin the range in package.json rather than expecting a lockfile here.
COPY package.json ./
RUN bun install --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV SANDBOX_SERVICE_PORT=3100

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

# Bun runs TypeScript directly — no build step, no dist to keep in sync.
CMD ["bun", "run", "src/index.ts"]

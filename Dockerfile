FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies cleanly from root lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Build Vue 3 Admin Panel
RUN bun run build:panel

# Persistent SQLite & encryption key directory
ENV G3_DATA_DIR=/var/lib/g3-data
ENV G3_HOST=0.0.0.0
ENV G3_PORT=8787
ENV G3_S3_PORT=9000
ENV NODE_ENV=production

RUN mkdir -p /var/lib/g3-data

EXPOSE 8787 9000

CMD ["bun", "server/index.ts"]

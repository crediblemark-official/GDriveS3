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
ENV GDRIVES3_DATA_DIR=/var/lib/gdrives3-data
ENV GDRIVES3_HOST=0.0.0.0
ENV GDRIVES3_PORT=8787
ENV GDRIVES3_S3_PORT=9000
ENV NODE_ENV=production

RUN mkdir -p /var/lib/gdrives3-data

EXPOSE 8787 9000

CMD ["bun", "server/index.ts"]

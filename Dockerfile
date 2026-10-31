# syntax=docker/dockerfile:1

# Node 22 LTS: @discordjs/voice (music) needs 22.12+, and Node 20 is end-of-life.
FROM node:22-alpine AS base
# Prisma's query engine needs openssl on alpine
RUN apk add --no-cache openssl
# Stops the Prisma CLI's update check / usage ping, which runs on every
# `prisma generate` and `migrate deploy` (so on every boot). No phone-home
# by default is a project rule, and its "update available" banner tempts
# hosts into a breaking major upgrade.
ENV CHECKPOINT_DISABLE=1
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# Links the published image to this repo on GitHub's container registry.
LABEL org.opencontainers.image.source="https://github.com/Bessv2/DiscordBot" \
      org.opencontainers.image.description="Self-hosted Discord moderation and community bot"

# MUSIC=true builds the "music" image: ffmpeg plus yt-dlp's official build,
# which bundles YouTube's challenge solver and runs it on the Node already
# here. That's roughly 150MB more on disk, so the default image skips it
# and hosts who never play music never download it.
ARG MUSIC=false
RUN if [ "$MUSIC" = "true" ]; then \
      apk add --no-cache ffmpeg python3 && \
      wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && \
      chmod a+rx /usr/local/bin/yt-dlp && yt-dlp --version; \
    fi
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# Strip CRLF in case the repo was checked out on Windows without
# .gitattributes applying (e.g. an older clone) — CRLF breaks the shebang.
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh && mkdir -p /app/data

VOLUME ["/app/data"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

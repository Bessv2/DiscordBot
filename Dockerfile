# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
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

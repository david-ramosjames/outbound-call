FROM node:20-slim AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/voice-worker/package.json apps/voice-worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/voice-worker apps/voice-worker
RUN pnpm --filter @outbound-call/shared build
RUN pnpm --filter @outbound-call/voice-worker build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/voice-worker/dist ./apps/voice-worker/dist
COPY --from=builder /app/apps/voice-worker/package.json ./apps/voice-worker/package.json
COPY --from=builder /app/apps/voice-worker/node_modules ./apps/voice-worker/node_modules

WORKDIR /app/apps/voice-worker
EXPOSE 3001
CMD ["node", "dist/index.js"]

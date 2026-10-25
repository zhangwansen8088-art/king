FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# 生成客户端只需合法连接格式，实际连接地址由运行时容器注入。
ENV DATABASE_URL=postgresql://prisma:prisma@127.0.0.1:5432/prisma

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.25.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @max-promotion/api...

COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts

RUN pnpm --filter @max-promotion/contracts build \
  && pnpm --filter @max-promotion/api prisma:generate \
  && pnpm --filter @max-promotion/api build

FROM node:24-bookworm-slim AS runtime

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.25.0 --activate

WORKDIR /workspace

COPY --from=build /workspace /workspace

WORKDIR /workspace/apps/api

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3000/api/health/live > /dev/null || exit 1

CMD ["node", "dist/main.js"]

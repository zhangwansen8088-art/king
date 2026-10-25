# Max 众推台

可自行部署的推广任务、资金和审核系统。前端使用 React + Vite + TypeScript + Tailwind CSS，后端使用 NestJS + PostgreSQL + Prisma，认证采用 JWT 与 HttpOnly 刷新 Cookie，并提供 Swagger / OpenAPI 文档。

## 当前入口

- 管理员后台：商户资料、钱包调账、任务发布、凭证审核、提现处理和审计日志。
- 推广客户工作台：领取任务、提交凭证、查看余额与流水、申请提现。
- 商户没有独立登录入口。商户资料和钱包仅作为后台经营主体与结算数据保留。

## 项目结构

```text
apps/api                NestJS API、Prisma 模型、认证和业务事务
apps/web                React 管理与推广前端
packages/contracts      前后端共用类型和金额规则
docs                    架构、部署、安全、备份和回滚说明
compose.yml             API、Web、PostgreSQL 和迁移容器编排
```

## 本地运行

要求 Node.js 22 或更高版本、pnpm 10 或更高版本、Docker。

```bash
cp .env.example .env
# 修改 .env 中的 JWT_SECRET、POSTGRES_PASSWORD 和演示账号密码
CI=true pnpm install
CI=true pnpm dev:db
CI=true pnpm db:generate
pnpm db:migrate
CI=true pnpm dev
```

打开 `http://localhost:5173`。Swagger 文档位于 `http://localhost:3000/api/docs`。

需要演示数据时，先在 `.env` 设置 `SEED_DEMO_DATA=true` 并修改演示密码，再运行：

```bash
CI=true pnpm db:seed
```

## 质量检查

```bash
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
```

## Docker Compose

生产配置至少需要修改数据库密码、JWT 密钥、正式域名和 Cookie 安全开关。具体步骤见 [部署说明](docs/deployment.md)。

```bash
docker compose up -d --build
```

当前版本没有接入真实支付通道、身份认证、广告平台数据或旧系统资金迁移。真实资金启用前必须完成预发布库演练、备份恢复演练和人工对账。

## 开源说明

项目代码按 [Apache License 2.0](LICENSE) 授权。主要依赖及许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。GitHub、VPS、域名和对象存储属于外部服务，不是免费开源软件；自托管 Coolify 和 Linux Docker Engine 可免费使用，但服务器资源仍需付费。

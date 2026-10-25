# 部署说明

## 本机开发

1. 复制配置：`cp .env.example .env`。
2. 修改 `JWT_SECRET`、数据库密码和演示账号密码。
3. 安装依赖：`pnpm install`。
4. 启动数据库：`pnpm dev:db`。
5. 生成数据库客户端并迁移：`pnpm db:generate && pnpm db:migrate`。
6. 需要演示数据时设置 `SEED_DEMO_DATA=true`，再运行 `pnpm db:seed`。
7. 启动前后端：`pnpm dev`。
8. 打开 `http://localhost:5173`，Swagger 位于 `http://localhost:3000/api/docs`。

## Docker Compose

1. 准备 `.env`，生产环境必须使用强随机密钥和强数据库密码。
2. 运行 `docker compose up -d --build`。
3. 健康检查通过后访问服务器 `8080` 端口或由 Coolify 反向代理的域名。
4. 生产环境不公开 PostgreSQL 端口。

健康检查分为两类：

- `GET /api/health/live`：只判断 API 进程是否存活，不访问数据库。
- `GET /api/health/ready`：检查数据库连通性，不可用时返回 HTTP 503。
- `GET /api/health`：保留旧地址兼容性，行为与就绪检查一致。

Docker 镜像自带的健康检查使用存活探针，避免数据库短暂波动导致 API 容器被反复重启。反向代理或 Coolify 的流量就绪检查应使用 `/api/health/ready`。

API 会为每个响应返回 `X-Request-ID`。如果反向代理已传入合法请求 ID，则沿用；否则自动生成。访问日志以单行 JSON 输出到标准输出，可用 `docker compose logs -f api` 查看。日志不包含请求体、Cookie、认证令牌和查询参数。

## Coolify / VPS

- 使用 Git 仓库部署，构建命令和启动命令由 Dockerfile 固定。
- 域名必须启用 HTTPS；`WEB_ORIGIN` 必须与正式域名完全一致。
- 数据卷必须放在持久磁盘，不能随容器重建丢失。
- 数据库每日全量备份、WAL 持续归档和异地副本必须单独配置。
- 上线前完成一次从备份恢复的演练，记录恢复耗时和数据校验结果。

## 上线门槛

- 自动测试、类型检查、构建全部通过。
- 生产密钥已更换，演示数据开关关闭。
- 数据库迁移和回滚脚本在预发布库演练通过。
- 备份恢复、告警通知和值班联系人已验证。
- 真实资金、支付和旧数据迁移另行审批，不能包含在普通发布中。

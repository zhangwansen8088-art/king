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

### 生产必填环境变量

Compose 部署只需在 `.env` 里确认下面几项，其余变量都有安全默认值。

| 变量                 | 生产要求                                                   | 不设置的后果                                                                            |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | 强随机密码                                                 | Compose 启动直接失败                                                                    |
| `JWT_SECRET`         | 至少 32 位随机字符串                                       | Compose 启动直接失败                                                                    |
| `COMPOSE_WEB_ORIGIN` | 正式域名，含 `https://` 与端口，例如 `https://example.com` | 登录、刷新、注销被来源校验判 `403`                                                      |
| `COOKIE_SECURE`      | 显式写 `true`                                              | Compose 默认给 `false`，覆盖代码里生产默认开启 Secure 的逻辑，刷新 Cookie 不带 `Secure` |
| `TRUST_PROXY_CIDRS`  | 按实际代理链收窄为明确 IP 或 CIDR                          | 保持默认网段时，外层代理地址可能不被信任，真实客户端 IP 取不到                          |
| `ENABLE_SWAGGER`     | 建议 `false`                                               | `/api/docs` 在生产对外暴露                                                              |

`WEB_ORIGIN` 与 `COMPOSE_WEB_ORIGIN` 不是同一个变量：容器内的 `WEB_ORIGIN` 由 `COMPOSE_WEB_ORIGIN` 注入，`.env` 里的 `WEB_ORIGIN` 只在宿主机直接运行 API 时生效。生产部署只改 `COMPOSE_WEB_ORIGIN`。

健康检查分为两类：

- `GET /api/health/live`：只判断 API 进程是否存活，不访问数据库。
- `GET /api/health/ready`：检查数据库连通性，不可用时返回 HTTP 503。
- `GET /api/health`：保留旧地址兼容性，行为与就绪检查一致。

Docker 镜像自带的健康检查使用存活探针，避免数据库短暂波动导致 API 容器被反复重启。反向代理或 Coolify 的流量就绪检查应使用 `/api/health/ready`。

API 会为每个响应返回 `X-Request-ID`。如果反向代理已传入合法请求 ID，则沿用；否则自动生成。访问日志以单行 JSON 输出到标准输出，可用 `docker compose logs -f api` 查看。日志不包含请求体、Cookie、认证令牌和查询参数。

## 登录防护与可信代理

| 环境变量                        | 默认值                           | 作用                                     |
| ------------------------------- | -------------------------------- | ---------------------------------------- |
| `LOGIN_MAX_FAILURES`            | `5`                              | 同一计数范围在窗口内允许的失败次数       |
| `LOGIN_WINDOW_MINUTES`          | `15`                             | 失败计数窗口，单位分钟                   |
| `LOGIN_LOCK_MINUTES`            | `15`                             | 达到阈值后的锁定时间，单位分钟           |
| `LOGIN_ATTEMPT_RETENTION_HOURS` | `24`                             | 已失效失败计数的清理保留时间，单位小时   |
| `TRUST_PROXY_CIDRS`             | `loopback,linklocal,uniquelocal` | 允许携带可信转发头的代理 IP 或 CIDR 列表 |

- 计数同时覆盖账号和客户端 IP，使用 SHA-256 哈希后写入 PostgreSQL；不得把计数表改为保存明文账号或 IP。
- `TRUST_PROXY_CIDRS` 必须按实际代理链收窄。生产环境优先填写 Nginx、Coolify 或负载均衡器的明确地址或 CIDR，禁止使用 `*`、`0.0.0.0/0` 或 `::/0`。
- 当前容器内 Nginx 使用 `$remote_addr` 覆盖 `X-Forwarded-For`，客户端直接伪造该请求头不会进入 API。
- 如果 Coolify 或其他反向代理位于本 Nginx 之前，必须先确认经过 `real_ip`（真实 IP）模块或平台等效配置后，`$remote_addr` 已变成真实客户端 IP。否则 `$remote_addr` 可能只是上游代理地址，`TRUST_PROXY_CIDRS` 又未包含它时，多个用户会共用同一 IP 计数；把它直接信任而链路上游未清洗转发头又会产生伪造风险。
- 上线前必须从两个不同公网客户端实测登录失败计数分别落到不同 IP 哈希，并验证伪造 `X-Forwarded-For` 不会减少失败次数。本仓库尚未完成这条生产代理链验证。

## 告警与日志保留

设置 `ALERT_WEBHOOK_URL` 后，API 会把 HTTP 5xx 的服务端错误摘要以 JSON POST 到该地址。告警只包含环境、请求 ID、方法、不含查询参数的路径、状态码和错误类型，不包含原始错误消息、请求体、Cookie、令牌或业务数据。生产环境应配置 HTTPS 地址；如使用仅限内网的 HTTP 接收端，必须确保地址不可从公网访问。Webhook 未配置或发送失败时，只有本地日志记录，不影响原接口响应；同类错误在 `ALERT_COOLDOWN_MINUTES` 内只发送一次。

登录达到失败阈值时也会发送 `login_lockout` 告警，只包含计数范围、SHA-256 哈希、失败次数和锁定截止时间，不包含账号、密码或原始 IP。告警与成功登录审计互不替代，告警失败也不会解除锁定。

审计日志自动清理由 `AUDIT_RETENTION_DAYS` 控制，默认值 `0` 表示关闭。启用时不得低于 30 天，建议先完成法务、财务和审计要求确认，再在预发布库观察至少一个清理周期。清理按 `AUDIT_CLEANUP_BATCH_SIZE` 分批执行，每 `AUDIT_CLEANUP_INTERVAL_HOURS` 小时检查一次，并在完成后写入 `AUDIT_LOG_RETENTION_CLEANUP` 系统审计记录。

日志保留清理不能替代数据库备份。资金流水和审计策略属于高风险运营配置，生产启用前必须保留旧日志副本并记录审批人、保留期限和回滚方式。

## Coolify / VPS

- 使用 Git 仓库部署，构建命令和启动命令由 Dockerfile 固定。
- 域名必须启用 HTTPS；Compose 部署时容器内的 `WEB_ORIGIN` 由 `.env` 的 `COMPOSE_WEB_ORIGIN` 注入，`COMPOSE_WEB_ORIGIN` 必须与正式域名完全一致（含协议与端口），否则登录、刷新、注销会被来源校验判 `403`。
- 数据卷必须放在持久磁盘，不能随容器重建丢失。
- 使用 `pnpm backup:create` 配置数据库每日全量备份；WAL 持续归档、加密和异地副本仍需单独配置。
- 上线前完成一次从备份恢复的演练，记录恢复耗时和数据校验结果。

## 上线门槛

- 自动测试、类型检查、构建全部通过。
- 生产密钥已更换，演示数据开关关闭。
- 数据库迁移在预发布库演练通过；仓库**没有**独立的迁移回滚脚本，回滚方式为「恢复最近一次可用备份，再重新前滚迁移」，必须把这条演练列入上线记录。
- 备份恢复、告警通知、登录锁定和真实客户端 IP 代理链已验证。
- 真实资金、支付和旧数据迁移另行审批，不能包含在普通发布中。

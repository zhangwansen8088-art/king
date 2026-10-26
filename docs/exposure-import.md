# 曝光数据人工导入

## 范围与数据模型

T10A v1 不连接外部广告平台，也不自动采集曝光。管理员按“任务 + 推广人 + 统计日”导入每日汇总数据，系统保存到 `ExposureDaily`。

- `taskId`：任务 UUID，必须存在。
- `promoterId`：推广客户 UUID，必须对应角色 `PROMOTER`。
- `statDate`：统计日，字符串格式 `YYYY-MM-DD`；必须是真实日历日期（例如 `2026-02-28` 合法，`2026-02-30` 非法）。
- `exposureCount`：曝光数，整数，必须大于等于 0。
- `clickCount`：点击数，整数，必须大于等于 0。
- `conversionCount`：转化数，整数，必须大于等于 0。
- `note`：备注，可选；未提供时为空字符串。

唯一键为 `taskId + promoterId + statDate`。同一唯一键重复导入采用 **upsert 覆盖**：更新三项数量和备注，不新增第二行，不做累加。

表结构和索引见 `apps/api/prisma/schema.prisma` 的 `ExposureDaily` 模型，以及迁移 `apps/api/prisma/migrations/20261026084409_add_exposure_daily/migration.sql`。

## 权限与接口

所有接口均在 `/api` 前缀下。管理员接口要求登录用户角色为 `ADMIN`；推广客户接口要求角色为 `PROMOTER`。未授权或角色不符时返回 `401/403`，请求体或查询参数不符合校验时返回 `400`。

### 1. 批量导入（管理员）

`POST /api/admin/exposures`

请求体为包含 `items` 的对象（字段见下例），一次请求可提交多条记录。服务端逐条校验任务、推广人、日期和非负整数后执行 upsert；每次导入写一条 `EXPOSURE_IMPORT` 审计记录，`detail` 记录本次导入条数。响应返回本次处理结果及导入后的记录。

示例：

```json
{
  "items": [
    {
      "taskId": "任务 UUID",
      "promoterId": "推广人 UUID",
      "statDate": "2026-10-25",
      "exposureCount": 1200,
      "clickCount": 86,
      "conversionCount": 12,
      "note": "渠道日报"
    }
  ]
}
```

> 实际 UUID 请替换示例中的占位文本；数量字段必须是 JSON 整数，不是金额字符串。

### 2. 查询曝光明细（管理员）

`GET /api/admin/exposures`

支持以下查询参数：

| 参数         | 类型                      | 说明         |
| ------------ | ------------------------- | ------------ |
| `taskId`     | UUID，可选                | 按任务筛选   |
| `promoterId` | UUID，可选                | 按推广人筛选 |
| `from`       | `YYYY-MM-DD`，可选        | 统计日下限   |
| `to`         | `YYYY-MM-DD`，可选        | 统计日上限   |
| `page`       | 正整数，可选，默认 1      | 页码         |
| `pageSize`   | 1–100 整数，可选，默认 20 | 每页条数     |

返回分页明细；每条明细包含任务标题 `taskTitle`，以及任务、推广人、统计日和三项数量、备注、时间戳。

### 3. 查询“我的曝光”（推广客户）

`GET /api/promoter/exposures`

接口始终使用当前登录推广客户的身份过滤数据，不能通过查询参数读取其他推广人的数据。支持 `from`、`to`、`page`、`pageSize`；未提供日期时，默认查询最近 30 个上海自然日。返回：

- `items`：当前推广客户可见的分页明细，含 `taskTitle`。
- `totals`：当前筛选范围内的 `exposureCount`、`clickCount`、`conversionCount` 合计。
- 分页元数据：页码、每页条数和总条数（以接口实际响应为准）。

推广端只读，不提供写入、修改或代查其他用户数据的能力。

## 迁移、备份与回滚

### 迁移前检查

1. 在临时测试库先执行迁移并跑完整测试。
2. 生产或预发布迁移前创建全库备份：

```bash
pnpm backup:create
pnpm test:backup-restore
```

`pnpm test:backup-restore` 调用 `scripts/verify-backup-restore.sh` 验证备份可恢复；备份文件路径和校验结果应记录在发布单中。不得在未验证备份的情况下执行生产迁移。

### 应用迁移

```bash
pnpm db:generate
pnpm db:migrate
```

本次迁移只创建 `ExposureDaily`、索引和两条外键，不修改既有表字段；上线前仍应在预发布库核对迁移 SQL 和查询权限。

### 回滚

本次没有独立的 down migration。发现问题时按以下顺序回滚：

1. 停止继续写入曝光数据并保留错误响应、请求 ID 和数据库日志。
2. 从迁移前、已通过恢复验证的备份恢复数据库。
3. 对 Prisma 迁移状态执行：

```bash
pnpm --filter @max-promotion/api exec prisma migrate resolve --rolled-back 20261026084409_add_exposure_daily
```

4. 回退应用提交（将 `<commit>` 替换为实际包含本次功能的提交）：

```bash
git revert <commit>
```

5. 恢复后重新执行 `pnpm db:generate`、类型检查、集成测试，并确认后台导入、推广端隔离和 totals 结果。

回滚只针对本次 T10A 提交和新表；不要用 `git reset --hard` 或强推改写受保护的 `main` 历史。

## 验收清单

- 管理员导入一行后，按任务/推广人/日期筛选可查到。
- 推广人 A 能看到自己的明细和合计；推广人 B 看不到 A 的数据。
- 相同唯一键再次导入后覆盖，不翻倍。
- 非法日期返回 `400`。
- 推广客户访问管理员接口返回 `403`。
- 单元、集成、API/Web 类型检查和格式检查均通过后，才可合并；合并不等于已上线。

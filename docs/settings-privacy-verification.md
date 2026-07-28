# 设置、隐私与个人数据删除自动化验证记录

> 状态：代码、类型检查和自动化测试已完成；2026-07-28 已同步开发环境 `cloud1`（`cloud1-d1gs4h1yj714bd6bc`）的集合、索引、权限和云函数。本次未配置删除执行令牌、未执行真实个人数据删除，也未进行真机、测试环境或生产环境验收。

## 1. 设置范围

- 偏好统一存放于 `user_settings`，不在 `users` 建立第二份偏好字段；
- 记账分组包含默认记账类型、默认支付方式和默认收款方式；
- 天气分组包含默认城市和是否优先使用定位；
- 分组 payload 使用 `expectedVersion`，只更新提交分组，其他分组保持原值；
- 默认固定渠道由云函数校验当前用户归属、存在性和启用状态；
- `updatedAt` 使用服务端时间；
- “我的 / 设置”提供清除天气快照、清除本地可再生缓存、隐私政策、用户协议、关于和版本信息。

## 2. 删除申请范围

- `dataDeletion.getStatus/request/cancel` 只从微信云函数上下文读取身份；
- 顶层身份字段会被拒绝，响应不返回 `openId` 或 `ownerId`；
- 同一申请复用顶层 `requestId`，同用户只能存在一个 `pending` 或 `processing` 申请；
- 冷静期固定为 7 天，仅 `pending` 可撤销；
- 申请后用户状态为 `deletion_pending`，撤销后恢复 `active`；
- 小程序前端常量只包含公共 `dataDeletion`，不包含后台执行器。

## 3. 后台执行器范围

- `dataDeletionExecutor` 是独立云函数，要求至少 24 字符的云端 `DATA_DELETION_EXECUTOR_TOKEN`；
- 只认领冷静期结束、失败重试到期或执行租约过期的申请；
- 按 `ownerId` 分批处理 `transactions`、`todos`、`todo_lists`、`categories`、`accounts` 和 `user_settings`，最后删除 `users`；
- 每批保存集合序号和删除数量，失败保存受控错误码与下次重试时间；
- 重复运行和目标文档已不存在时保持安全；
- 共享 `weather_cache` 和 `data_deletion_requests` 不作为用户业务正文删除。

## 4. 自动化覆盖

- 设置分组更新互不覆盖；
- 默认渠道跨用户和停用负向校验；
- 删除申请 7 天冷静期、幂等、重复申请、撤销和非法状态；
- 客户端身份伪造拒绝；
- 后台令牌拒绝、冷静期筛选、跨用户隔离、分批进度、失败恢复和重复执行；
- 交易新增、编辑和删除前后固定渠道文档逐字段不变；
- 天气快照和首页快照可显式清除；
- 收支、流水、统计、Todo、天气和首页既有回归。

## 5. CloudBase 开发环境同步

2026-07-28 使用微信开发者工具连接唯一已配置的开发环境 `cloud1`（`cloud1-d1gs4h1yj714bd6bc`），完成：

- 创建 `data_deletion_requests`，并设置为“所有用户不可读写”；
- 确认 `user_settings` 继续为“所有用户不可读写”；
- 创建 `uq_data_deletion_owner`（`ownerId` 唯一）、`idx_data_deletion_runnable`（`status + cooldownEndsAt`）、`idx_data_deletion_retry`（`status + nextRetryAt`）和 `idx_data_deletion_lease`（`status + leaseExpiresAt`）；
- 确认 `user_settings.uq_user_settings_owner`（`ownerId` 唯一）已存在；
- 通过“上传并部署：云端安装依赖”部署 `dataDeletion`（23:07:36）、`dataDeletionExecutor`（23:08:12），并更新 `ledger`（23:08:43）和 `user`（23:09:09）；
- 刷新函数列表后确认 `dataDeletionExecutor`、`dataDeletion`、`home`、`weather`、`todo`、`ledger`、`user` 均为“已部署”；
- 已部署函数中不存在余额、账户管理或转账函数，因此没有执行函数删除；
- 开发环境不存在 `account_balance_mutations` 集合；未批量删除 `accounts` 中可能存在的历史余额字段。

`dataDeletionExecutor` 当前未配置 `DATA_DELETION_EXECUTOR_TOKEN`，因此会按代码设计拒绝所有执行请求；本次也未创建定时触发器或调用该函数。控制台显示其运行时为 Node.js 16.13、内存 256 MB、超时 3 秒。

## 6. 后续统一 CloudBase 验收

1. 在专门验收任务中配置至少 24 字符的云端执行令牌、适当提高执行器超时，并配置受控的后台定时触发；令牌不得进入仓库或小程序前端；
2. 验证设置旧记录在用户重新进入后从单默认渠道迁移为默认支付/收款两个字段；
3. 先使用专门测试用户验证申请和撤销，不执行真实删除；
4. 正式删除验证必须准备备份、逐集合计数并再次取得明确授权；
5. 测试环境和生产环境需分别重复集合、权限、索引、函数、令牌、告警和恢复验证；
6. 本次未修改生产环境，也未执行真机或完整上线验收。

# 收支账单编辑与逻辑删除部署验证

本清单验证收入和支出的编辑、逻辑删除。物理删除、恢复、余额和预算不在范围内。完整 `OPENID`、备注正文和环境凭证不得写入验证记录。

## 1. 部署准备

1. 在根目录执行 `npm.cmd run check` 与 `npm.cmd run build:cloudfunctions`。
2. 确认 `transactions`、`categories`、`accounts` 均为“所有用户不可读写”。
3. 保留 `uq_transactions_owner_request` 和 `idx_transactions_owner_type_active_occurred_id`；本任务不新增索引或集合。
4. 右键 `cloudfunctions/ledger`，选择“上传并部署：云端安装依赖”。函数名仍为 `ledger`，入口仍为 `index.main`。
5. 重新编译小程序，确认收入和支出流水记录均可点击进入对应编辑页。

历史交易不需要迁移；`lastMutationRequestId`、`lastMutationKind`、`lastMutationFingerprint`、`lastMutationPreviousOccurredAt` 会在首次成功编辑或删除时写入。

## 2. 修改金额

1. 记录目标账单的脱敏 ID、`amountInCents`、`createdAt`、`updatedAt`、`version` 和当日/当月汇总。
2. 将 `12.50` 元改为 `18.80` 元并保存。
3. 验证数据库金额为 `1880`，`createdAt` 不变，`updatedAt` 更新，`version + 1`。
4. 返回流水后验证当日和本月增加 `6.30`，旧 cursor 已清除且重新从第一页加载。

## 3. 日期和跨月

1. 同月把 7 月 21 日改为 7 月 20 日：记录只出现在新日期组，两个日期小计正确，本月总额不变。
2. 再把该记录从 7 月移到 6 月：返回 7 月后记录消失、7 月总额减少；切换 6 月后记录出现、6 月总额增加。
3. 多页数据下重新上拉，确认无重复、无遗漏，不能继续使用编辑前游标。

## 4. 分类、账户和备注

1. 改为当前用户另一启用的同类型分类和账户，验证数据库只更新 ID，流水名称和图标通过实时关联正确显示。
2. 验证收支类型不匹配分类、停用分类、他人分类、停用账户和他人账户均被云函数拒绝；编辑请求不能改变原账单类型。
3. 验证备注会 trim，空值保存为 `null`，201 字被拒绝。

## 5. 删除

1. 点击删除后先取消，确认没有云函数删除请求和数据变化。
2. 再次点击并确认，验证文档仍存在，`isDeleted=true`、`deletedAt`/`updatedAt` 为服务端时间、`version + 1`、`createdAt` 不变。
3. 验证普通详情返回 `TRANSACTION_NOT_FOUND`，流水、每日小计和月度汇总不再包含该记录。
4. 同一删除 requestId 重试返回 `deleted=true, alreadyDeleted=true`；不同 requestId 再删返回 `TRANSACTION_ALREADY_DELETED`。

## 6. 并发和隔离

1. 两个窗口打开同一账单；窗口 A 保存后，窗口 B 用旧版本保存或删除，应返回 `TRANSACTION_CONFLICT`，A 的结果不得被覆盖。
2. 冲突页面保留输入并提供“重新加载”；重新加载前提示会丢失未保存修改。
3. 使用两个微信账号验证 A 无法读取、编辑或删除 B 的交易；已知 B 的 transactionId 也只返回 `TRANSACTION_NOT_FOUND`。
4. 请求携带 `ownerId`、`userId` 或任意 `openId` 字段必须返回 `INVALID_ARGUMENT`。

## 7. 页面状态

- 初次加载有 loading，失败有 error/retry；无修改时保存禁用。
- 修改后离开页面出现“修改尚未保存”确认；保存或删除成功返回时不再提示。
- 保存和删除期间两个按钮均禁用；失败保留表单/页面，同一次重试复用 requestId。
- 删除确认取消不发请求，冲突不自动覆盖。

验证记录需注明日期、小程序版本、环境 ID 后四位、`ledger` 部署时间、脱敏 requestId、各场景结果和错误码。未在真实 CloudBase 执行的项目必须标记“待人工验证”。

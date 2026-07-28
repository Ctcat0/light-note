# 新增收支 CloudBase 真实环境验证

本文验证“新增一笔收入或支出 → 云函数写入 → 按 ID 查询确认”的最小闭环。测试前先按 [`database-setup.md`](./database-setup.md) 创建 `transactions` 集合、权限、索引并部署 `ledger` 云函数。不要记录或截图完整 `OPENID`。

## 1. 部署前检查

1. 执行 `npm.cmd run check`，确认类型检查、Lint、全部测试和两个云函数构建通过。
2. 在 CloudBase 数据库创建 `transactions`，数据权限设置为“所有用户不可读写”。
3. 创建唯一索引 `uq_transactions_owner_request`：`ownerId` 升序、`requestId` 升序、勾选唯一。
4. 为选项加载创建普通索引：
   - `idx_categories_owner_type_enabled_sort`：`ownerId`、`type`、`isEnabled`、`sortOrder`，全部升序；
   - `idx_accounts_owner_enabled_sort`：`ownerId`、`isEnabled`、`sortOrder`，全部升序。
5. 右键 `cloudfunctions/ledger`，选择“上传并部署：云端安装依赖”；确认函数名 `ledger`、入口 `index.main`、超时 10 秒。
6. 重新编译小程序，确认控制台无编译错误。

## 2. 正常新增

1. 使用已经完成用户初始化的开发账号进入底部“记账”，在流水页点击“新增支出”。
2. 输入 `12.50` 元，选择“餐饮”和默认微信账户。
3. 确认日期时间，备注输入“午餐”，点击“保存支出”。
4. 页面应显示“支出账单保存成功”和已查询确认的账单编号；点击“返回账单流水”后应触发一次刷新。
5. 在 `transactions` 检查只有一条对应记录：
   - `amountInCents = 1250`、`type = expense`；
   - `ownerId` 指向当前内部用户；
   - 分类和账户均属于该 `ownerId`；
   - `note = 午餐`、`merchant = null`、`tags = []`、`attachmentUrls = []`；
   - `includeInBudget = true`、`isDeleted = false`、`version = 1`；
   - `createdAt`、`updatedAt` 为服务器时间，且不存在客户端传入的 `openId` 或 `userId`。

## 3. 连续点击与请求重试

1. 快速连续点击保存，确认按钮在提交期间禁用，只出现一次成功反馈且集合只增加一条。
2. 在开发者工具中模拟弱网，使首次响应不确定，然后点击页面“重试保存”。
3. 确认重试复用同一个 `requestId`，集合不新增第二条，页面显示已确认原记录。
4. 修改任一表单字段后重新保存，确认生成新的 `requestId` 和新账单。

收入场景切换到“收入”后新增一笔 `80.00` 元记录并选择收入分类。除 `type = income`、`includeInBudget = false` 外，其余归属、整数金额、幂等和审计要求与支出一致；收入分类不得用于支出，支出分类也不得用于收入。

## 4. 异常输入

逐项验证空金额、`0`、负数、三位小数、超大金额、未选择分类、未选择支付/收款方式、超过当前时间 5 分钟的时间和 201 字备注。页面应阻止提交或显示受控错误，表单内容不得丢失。

在开发环境构造一个停用的支出分类和固定渠道后重新打开页面，它们不应出现在选项中。若使用旧页面状态强行提交，云函数应分别返回 `CATEGORY_DISABLED`、`ACCOUNT_DISABLED`。固定渠道不提供用户侧停用入口；该负向验证只能使用隔离测试数据，不应在生产环境测试。

## 5. 多用户隔离

1. 分别使用两个微信测试账号完成用户初始化和支出创建。
2. 确认两个账号只看到自己的启用分类和账户，写入的 `ownerId` 各自独立。
3. 用账号 A 调用 `getTransaction` 查询账号 B 的账单 ID，应返回 `TRANSACTION_NOT_FOUND`，不能返回记录或透露其是否存在。
4. 确认客户端直接访问 `transactions` 被数据库权限拒绝。

## 6. 结果记录

记录日期、小程序版本、环境 ID 后四位、`ledger` 更新时间、脱敏 requestId、场景结果和错误码。不要记录完整 `OPENID`、账单备注截图、密钥或云环境凭证。本地自动化测试不能替代以上真实 CloudBase 验证。

## 7. 2026-07-21 开发环境实测

环境 ID 后四位为 `d6bc`。本次已在微信开发者工具和 CloudBase 控制台完成以下验证：

- 已创建 `transactions` 集合，并确认数据权限为“所有用户不可读写”；
- 已创建唯一索引 `uq_transactions_owner_request`，字段为 `ownerId`、`requestId`；
- 已创建分类和账户的普通查询索引；
- `ledger` 已部署，运行环境为 `Nodejs16.13`，入口为 `index.main`，内存为 `256 MB`，执行超时为 `10` 秒；
- 小程序重新编译后，记账页面成功从真实云函数加载“餐饮”和默认“微信”账户；
- 已新增一笔 `12.50` 元的支出，页面显示“支出账单保存成功”，并通过 `getTransaction` 按账单 ID 查询确认；
- 控制台记录确认 `amountInCents = 1250`、`type = expense`、`includeInBudget = true`、`isDeleted = false`、`version = 1`，分类、账户和 `ownerId` 已写入，未出现客户端传入的 `openId` 或 `userId` 字段；
- 本次测试记录的可选备注为 `null`，因此真实环境备注写入仍需单独人工验证。

本次未执行弱网重试、快速并发重复提交、停用分类或账户、多微信账号隔离测试。这些场景涉及额外数据修改或第二个微信测试账号，不能标记为已经通过。

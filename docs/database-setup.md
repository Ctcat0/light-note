# CloudBase 部署、用户初始化与记账集合配置

本文是 `user.init` 和 `ledger` 部署到真实微信 CloudBase 环境前后的操作清单。代码、自动化测试与本地模拟通过不代表新云函数和集合已经部署。

## 1. 当前部署状态

- 本地云函数入口、共享类型、前端 service、应用启动调用和开发版诊断已实现。
- 本地类型检查、Lint、契约测试及云函数构建可以执行。
- 2026-07-21 已在开发环境完成 `user` 云函数部署、集合创建、权限设置、唯一索引创建和日志服务启用；这些控制台资源不会由本仓库自动创建，测试与生产环境仍需逐环境配置。
- `ledger` 的支出新增、流水、编辑和逻辑删除版本已在开发环境部署并完成真实微信身份验证；收入闭环、独立月度汇总和首页收支摘要已完成本地实现与自动测试，需重新部署 `ledger` 并重新编译小程序后生效，本次尚未执行这些新增能力的人工验收。
- `transactions`、`categories`、`accounts` 的流水查询组合索引已在开发环境创建并变为可用，控制台已确认支持 `_id` 作为组合索引字段。
- 当前开发环境 ID 只保存在被 Git 忽略的 `.env.local` 中。
- 测试版和生产环境 ID 默认留空，体验版或正式版会安全失败，不会误连开发库。

## 2. 环境配置

### 2.1 小程序端环境选择

复制配置示例并填入环境 ID：

```powershell
Copy-Item .env.example .env.local
npm.cmd run configure:env
```

`.env.local` 只允许配置以下公开环境标识：

```dotenv
CLOUD_ENV_ID_DEVELOPMENT=your-development-env-id
CLOUD_ENV_ID_TEST=your-test-env-id
CLOUD_ENV_ID_PRODUCTION=your-production-env-id
```

生成的 `miniprogram/config/environment.runtime.ts` 和 `.env.local` 都被 Git 忽略。不得把 `SecretId`、`SecretKey`、`AppSecret`、天气 Key 或其他凭证放入这两个文件。

运行时按微信版本自动选择环境：

| 微信版本 | `envVersion` | CloudBase 配置 |
| --- | --- | --- |
| 开发版 | `develop` | `CLOUD_ENV_ID_DEVELOPMENT` |
| 体验版 | `trial` | `CLOUD_ENV_ID_TEST` |
| 正式版 | `release` | `CLOUD_ENV_ID_PRODUCTION` |

任一目标环境 ID 为空时，前端返回 `CLOUD_NOT_CONFIGURED`，不会调用云函数。生产环境 ID 应由发布机或 CI 的环境变量注入后运行 `npm run configure:env`，不得提交生成文件。

### 2.2 云函数端环境

`user` 和 `ledger` 云函数均使用：

```ts
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
```

因此同一构建产物部署到开发、测试或生产环境时自动使用函数所在环境，不需要 `SecretId`、`SecretKey` 或自定义环境变量。用户初始化目前也不依赖任何业务环境变量。

### 2.3 微信项目配置检查

仓库根目录 `project.config.json` 必须保持：

- `miniprogramRoot: "miniprogram/"`；
- `cloudfunctionRoot: "cloudfunctions/"`；
- `compileType: "miniprogram"`；
- `useCompilerPlugins` 包含 `typescript`；
- `appid` 是已经与目标 CloudBase 环境关联的小程序 AppID。

本机设置写入被忽略的 `project.private.config.json`，不得提交个人代理、最近打开页面或其他本机状态。

## 3. 集合、权限与索引

### 3.1 必须提前创建的集合

在目标环境的“云开发 → 数据库”中手动创建：

| 集合 | 初始化用途 | 客户端权限 |
| --- | --- | --- |
| `users` | `OPENID` 到内部用户的映射 | 仅管理端可读写 |
| `user_settings` | 默认账户、时区和用户偏好 | 仅管理端可读写 |
| `categories` | 默认收入/支出分类 | 仅管理端可读写 |
| `accounts` | 默认账户 | 仅管理端可读写 |
| `transactions` | 用户收入/支出事实；当前只写支出 | 仅管理端可读写 |

当前云函数没有调用集合管理 API；`database.collection(name)` 只是取得集合引用。因此不能依赖首次写入自动建集合，部署前必须在每个环境分别创建。

“仅管理端可读写”会拒绝小程序客户端直接访问，但不会阻止运行在云端的云函数使用服务端权限。页面和前端 service 均不得调用 `wx.cloud.database()`；权限规则只是第二道防线，云函数仍按可信身份校验 `ownerId`。

### 3.2 必需唯一索引

依次进入“数据库 → 集合 → 索引管理 → 新建索引”，字段全部使用升序，并勾选“唯一”：

| 集合 | 索引名 | 字段顺序 | 唯一 |
| --- | --- | --- | --- |
| `users` | `uq_users_open_id` | `openId` | 是 |
| `user_settings` | `uq_user_settings_owner` | `ownerId` | 是 |
| `categories` | `uq_categories_owner_type_system_key` | `ownerId`, `type`, `systemKey` | 是 |
| `accounts` | `uq_accounts_owner_system_key` | `ownerId`, `systemKey` | 是 |
| `transactions` | `uq_transactions_owner_request` | `ownerId`, `requestId` | 是 |

早期需求中的 `userId` 已按确认的数据模型统一为 `ownerId`，不要再建立一套 `userId` 字段或索引。

### 3.3 必需查询索引

支出页面会查询当前用户启用的分类和账户，因此部署 `ledger` 前必须增加以下普通索引，字段均升序：

| 集合 | 建议字段顺序 | 用途 |
| --- | --- | --- |
| `categories` | `ownerId`, `type`, `isEnabled`, `sortOrder` | 当前用户分类列表 |
| `accounts` | `ownerId`, `isEnabled`, `sortOrder` | 当前用户账户列表 |
| `categories` | `ownerId`, `_id` | 流水页批量关联当前分类名称和图标 |
| `accounts` | `ownerId`, `_id` | 流水页批量关联当前账户名称和图标 |
| `transactions` | `ownerId` 升序, `type` 升序, `isDeleted` 升序, `occurredAt` 降序, `_id` 降序 | 指定月份支出流水、复合游标和全月聚合 |

索引名称建议分别使用 `idx_categories_owner_id`、`idx_accounts_owner_id` 和 `idx_transactions_owner_type_active_occurred_id`，全部为普通非唯一索引。不要再创建旧草案中的 `transactions(ownerId, isDeleted, occurredAt)` 或 `transactions(ownerId, isDeleted, type, occurredAt)`，它们不能完整覆盖当前 `_id` 次级排序且会形成重复索引。控制台若根据实际查询提示不同字段方向，应停止验证并记录提示，不要静默改动文档或查询。

### 3.4 并发保护

初始化为用户、设置、19 个系统分类和 5 个系统账户生成确定性 `_id`，并在单个服务端事务内按文档 ID 读写。即使唯一索引漏配，同一用户、同一 `systemKey` 的快速并发请求也会竞争同一个文档 ID，不会各自生成随机副本；事务最多重试 3 次。

唯一索引仍是上线必需的数据库完整性防线，可阻止历史脚本或未来其他入口按相同业务键写出重复记录。若目标 CloudBase 环境无法创建上述唯一组合索引，应停止生产发布并记录控制台错误，不能只依赖应用代码宣称约束已完成。

账单创建使用 `ownerId + requestId` 派生确定性 `_id`，并在事务内先读后写。同一请求并发时会竞争同一文档；事务重试后返回已创建记录。`uq_transactions_owner_request` 仍必须建立，避免未来其他写入入口绕过确定性 ID。

收入和支出编辑、逻辑删除都使用现有 `ledger` 云函数和 `transactions` 单文档事务。它们按文档 `_id` 读取后校验 `ownerId`、记录原类型、`isDeleted`、`version`，不需要新增索引或集合。部署时只需重新上传 `cloudfunctions/ledger`；既有流水复合索引、创建幂等唯一索引和“所有用户不可读写”权限必须保留。历史交易无需批量迁移，最近变更幂等字段会在首次编辑或删除时写入。

## 4. 云函数部署

### 4.1 本地准备

```powershell
npm.cmd install
npm.cmd --prefix cloudfunctions/user install
npm.cmd --prefix cloudfunctions/ledger install
npm.cmd run check
npm.cmd run build:cloudfunctions
node -e "require('./cloudfunctions/user/index.js'); require('./cloudfunctions/ledger/index.js'); console.log('cloudfunction entries ok')"
```

部署目录必须包含：

- `index.js`；
- `package.json` 和 `package-lock.json`；
- 已生成的对应 `dist/cloudfunctions/<function>/src/**`；
- 不需要上传仓库根目录或本地绝对路径。

`index.js` 加载编译后的 CommonJS 入口，函数名分别为目录名 `user` 和 `ledger`，与前端调用名称一致。选择“云端安装依赖”时由云端读取各函数目录内的 `package.json`。

### 4.2 开发者工具部署

1. 用微信开发者工具打开包含 `project.config.json` 的仓库根目录。
2. 在工具栏选择正确的开发 CloudBase 环境，确认环境 ID 与 `.env.local` 一致。
3. 确认小程序 AppID 已在目标环境“环境配置 → 安全配置 → 小程序关联”中绑定。
4. 依次右键 `cloudfunctions/user`、`cloudfunctions/ledger`，选择“上传并部署：云端安装依赖”。
5. 确认控制台显示的函数运行时、内存和超时。当前开发环境由微信开发者工具部署为 `Nodejs16.13`、256 MB、10 秒，并已通过真实初始化；不要在未做兼容性回归时直接切换运行时。测试和生产环境应优先评估平台当前提供的较新稳定 Node.js 运行时，并重新执行第 6 节全部场景。
6. 部署完成后在函数列表确认名称为 `user`、`ledger`，入口均为 `index.js`，最近版本状态成功；两个函数超时均设置为 10 秒。
7. 重新编译小程序。

云函数无业务环境变量要求；不要为它添加永久云 API 凭证。流水查询异常会返回受控的 `TRANSACTION_LIST_FAILED` 或 `TRANSACTION_SUMMARY_FAILED`，其他数据库异常返回 `DEPENDENCY_ERROR`。如果平台在 10 秒处直接终止函数，则平台可能来不及返回统一响应；前端 15 秒超时会转换为带 `requestId` 的 `NETWORK_ERROR`，且不会自动无限重试。

## 5. 开发版诊断

开发版首页显示非敏感初始化诊断：

- 是否成功取得微信身份；
- 是否创建新用户；
- 本次创建的支出分类、收入分类和账户数量；
- 是否已经设置 `defaultAccountId`；
- 是否为完整重复初始化；
- `requestId` 和错误码。

诊断只在 `envVersion = develop` 时显示。体验版和正式版不会显示内部诊断，也不会展示完整 `OPENID`。失败后仅由用户点击重试；应用没有定时器或递归自动重试。

## 6. 端到端验证清单

所有删除、停用和并发测试只允许在开发环境执行。每次验证记录小程序版本、环境 ID 后四位、函数版本、时间、`requestId` 和结果，不记录完整 `OPENID`。

### 场景一：首次进入

1. 使用从未进入该开发环境的微信测试账号打开小程序。
2. 首页诊断应为：身份已获取、新建用户“是”、支出 `11`、收入 `8`、账户 `5`、默认账户“已设置”、错误码 `OK`。
3. 在控制台按该条 `users._id` 查询：
   - `users` 新增 1 条；
   - `categories` 中该 `ownerId` 共 19 条，`expense` 11 条、`income` 8 条；
   - `accounts` 中该 `ownerId` 共 5 条；
   - `user_settings.defaultAccountId` 指向同一 `ownerId` 且 `systemKey = account_wechat` 的账户。

### 场景二：重复进入

1. 记录四个集合的数量和当前默认账户。
2. 关闭小程序后重新进入，或在开发者工具重新编译。
3. 首页诊断应显示各创建数量为 `0`，重复初始化“是”。
4. 确认用户、分类、账户数量未增加，`defaultAccountId` 未改变，`lastLoginAt` 晚于首次调用。

### 场景三：部分数据缺失

1. 备份当前开发账号数据。
2. 在控制台删除一个系统分类，重新进入；确认只补回 1 个对应分类。
3. 删除一个非默认系统账户，重新进入；确认只补回 1 个账户。
4. 不得通过本场景删除用户当前默认账户。确认其他分类、账户名称、启用状态和默认设置未被覆盖。

### 场景四：多用户隔离

1. 分别用两个微信测试账号进入同一开发环境。
2. 确认产生两个不同 `users._id`，各自有 19 个分类、5 个账户和 1 条设置。
3. 两条 `defaultAccountId` 分别指向本人的微信账户，不得交叉。
4. 客户端直接调用数据库应被“仅管理端可读写”拒绝；构造包含 `userId`、`openId` 或 `ownerId` 的初始化 payload 应返回 `INVALID_ARGUMENT`。

### 场景五：快速重复调用

1. 在开发者工具中快速点击诊断错误态的重试，或并行触发相同 `user.init` 请求。
2. 确认用户仍为 1 条、系统分类仍为 19 条、系统账户仍为 5 条。
3. 检查云函数日志只包含平台调用信息和受控错误，不应出现完整 `OPENID`、密钥或堆栈返回值。

## 7. 本地模拟与真实环境差异

本地 `InMemoryUserInitializationStore` 覆盖事务回滚、并发串行、部分缺失和多用户隔离；契约测试覆盖环境选择、空环境、请求字段、响应解析、超时、失败后显式重试和请求去重。

本地测试不能证明以下平台行为：

- `getWXContext()` 是否由真实微信调用注入 `OPENID`；
- 目标环境是否已关联当前 AppID；
- CloudBase 事务冲突重试和实际错误码形态；
- 控制台唯一索引和权限是否生效；
- 云函数运行时、冷启动、超时与云端安装依赖是否正常。

因此第 6 节五个场景必须在微信开发者工具和 CloudBase 控制台人工执行，不能用 mock 结果替代。

## 8. `wx-server-sdk` 依赖结论

当前直接生产依赖只有 `wx-server-sdk@3.0.1`。安装时出现的弃用提示来自间接依赖：

- `har-validator@5.1.5`；
- `uuid@3.4.0`；
- `request@2.88.2`。

依赖路径主要是 `wx-server-sdk → @cloudbase/node-sdk@2.10.0 → request`。这不只是维护提示：使用 npm 官方 registry 执行 `npm audit` 检出 12 项间接依赖漏洞（2 critical、6 high、4 moderate），涉及 `axios`、`form-data`、`jsonwebtoken`、`lodash.set`、`lodash.unset`、`request`、`qs`、`tough-cookie` 和 `uuid`。初始化接口不接受任意 URL 或业务 payload，也不直接调用这些 HTTP 工具，降低了当前暴露面，但不能把审计结果表述为“无安全风险”。

版本调查结果：

- npm 的最新稳定版是 `wx-server-sdk@4.0.2`，使用 `@cloudbase/node-sdk@3.17.2`；
- `3.0.4` 仍依赖 `@cloudbase/node-sdk@2.10.0`，不能解决当前依赖树问题；
- 当前微信小程序云函数官方示例仍明确使用 `3.0.1`；
- `4.0.2` 是跨主版本升级，且尚未经过本项目真实 CloudBase 初始化场景验证。

本次保留 `3.0.1`，避免在部署验证前盲目跨主版本升级。开发环境验证可以继续；生产发布前必须另开依赖升级任务，在隔离环境测试 `4.x` 的 `cloud.init`、`getWXContext`、数据库事务、错误码、冷启动和上述五个端到端场景，并重新执行官方 registry 的 `npm audit`。`npm audit fix --force` 建议降级到 `2.5.3`，不得采用。

## 9. 真实开发环境验证记录

2026-07-21 在微信开发者工具和开发环境 CloudBase 控制台完成以下验证。记录不包含完整 `OPENID` 或其他敏感信息。

- 已创建 `users`、`user_settings`、`categories`、`accounts` 四个集合，并将客户端权限设置为“所有用户不可读写”。
- 已创建 `transactions` 集合，并确认 `transactions`、`categories`、`accounts` 的客户端权限均为“所有用户不可读写”。
- 已创建第 3.2 节列出的四个唯一索引。
- 已创建 `uq_transactions_owner_request` 唯一索引，以及 `idx_transactions_owner_type_active_occurred_id`、`idx_categories_owner_id`、`idx_accounts_owner_id` 三个流水查询索引；字段顺序和升降序与第 3.3 节一致，索引均已可用。
- 已部署 `user` 云函数并启用开发环境日志服务。
- 已于 2026-07-21 22:58 部署包含 `listTransactions` 的 `ledger` 云函数。云端测试在无微信调用上下文时返回受控 `UNAUTHENTICATED`，证明新入口已生效且不会信任测试请求伪造身份；日志记录了一次约 604 ms 的冷启动。
- 云函数实际配置已复核为 `Nodejs16.13`、256 MB、10 秒超时且无业务环境变量；运行时升级留作独立兼容性任务，不与本次真实初始化验证混改。
- 首次进入成功：身份已获取、新建用户 1、支出分类 11、收入分类 8、账户 5、默认账户已设置、错误码 `OK`。
- 控制台计数确认：`users` 1 条、`user_settings` 1 条、`categories` 19 条、`accounts` 5 条。
- 重复进入成功：新建用户为否，分类和账户新增数均为 0，重复初始化为是，错误码 `OK`；集合记录数未增加，`lastLoginAt` 已更新。
- 真实调用曾暴露 CloudBase 会注入顶层运行时元数据；入口现只读取协议字段，同时仍明确拒绝调用方伪造的 `userId`、`ownerId` 和各种 `openId` 字段。修复后已重新部署并通过真实调用。
- 微信开发者工具完成真实 GUI 编译后，开发账号的 2026 年 7 月流水页成功展示原有两笔餐饮支出 `¥15.00`、`¥12.50`，并写入 20 笔 `¥0.01` 的开发分页验收记录。全月 22 笔、月度汇总 `¥27.70`；7 月 21 日 21 笔且跨页合并后小计 `¥27.69`，7 月 20 日 1 笔且小计 `¥0.01`。
- 首次只加载 20 条，月度汇总已经包含全月 22 条；上拉后第二页无重复、无遗漏并显示“没有更多了”。下拉刷新后再次分页得到相同结果。
- 通过开发者工具运行时的一次性调用代理验证第二页失败状态：第一页和汇总保留、显示明确重试入口；代理在拒绝前自动恢复，点击重试后真实 CloudBase 请求成功。最终重新编译清除调试状态，开发者工具为 `Errors: 0`、`Problems: 0`。

以下场景尚未在真实环境完成，不应标记为通过：

- 场景三“部分数据缺失”需要删除开发环境记录，属于破坏性验证，执行前需再次确认并先记录待恢复数据。
- 场景四“多用户隔离”需要第二个微信测试账号。
- 场景五的真实并发调用尚未执行；确定性文档 ID、唯一索引和本地并发测试已形成三层保护，但不能代替云端并发实测。
- 流水页 21 笔以上的第二页加载、跨分页同日合并、多日小计、刷新后重新分页和第二页失败重试均已完成真实开发者工具验证。20 笔一分钱开发测试记录暂时保留到多用户隔离验收完成；后续清理必须按精确交易 ID 执行并在删除前再次确认。
- 测试环境和生产环境尚未创建或切换；正式发布前应重复集合、权限、索引、函数部署和全部端到端验证。

## 10. 参考资料

- [微信小程序调用 CloudBase 云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- [CloudBase 数据库权限模式](https://docs.cloudbase.net/recipes/add-database-wechat-miniprogram)
- [CloudBase 索引管理](https://docs.cloudbase.net/database/data-index)
- [CloudBase 事务](https://docs.cloudbase.net/database/transaction)
- [CloudBase 云函数运行时](https://docs.cloudbase.net/cloud-function/runtime-support)

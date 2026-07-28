# CloudBase 部署、业务集合与天气配置

本文是 `user`、`ledger`、`todo`、`weather` 和 `home` 部署到真实微信 CloudBase 环境前后的操作清单。代码、自动化测试与本地模拟通过不代表新云函数和集合已经部署。

## 1. 当前部署状态

- 本地云函数入口、共享类型、前端 service、应用启动调用和开发版诊断已实现。
- 本地类型检查、Lint、契约测试及云函数构建可以执行。
- 2026-07-21 已在开发环境完成 `user` 云函数部署、集合创建、权限设置、唯一索引创建和日志服务启用；这些控制台资源不会由本仓库自动创建，测试与生产环境仍需逐环境配置。
- `ledger` 的收入/支出新增、流水、编辑和逻辑删除版本已在开发环境重新部署；混合流水索引已创建，小程序已重新编译。2026-07-22 用户确认收入新增、编辑、跨月编辑、删除、混合流水、月度汇总、用户隔离、并发保护、分页重试和支出回归的真实环境人工验收全部通过。
- `transactions`、`categories`、`accounts` 的流水查询组合索引已在开发环境创建并变为可用，控制台已确认支持 `_id` 作为组合索引字段。
- 曾开发但未部署的错误资金渠道资产核算实现已从代码、类型、页面、测试和正式文档中移除。真实开发环境此前只部署了纯收支闭环，因此无需回滚交易或重新计算任何渠道数据。
- 2026-07-22 已创建统计分类下钻索引并重新部署 `ledger`；月度概览、6/12 个月趋势、分类排行和分类下钻均已在真实开发环境通过。
- 2026-07-22 已在开发环境创建 `todo_lists`、`todos` 及待办索引，客户端权限均为“所有用户不可读写”；`todo` 云函数已部署，默认清单、创建、编辑、完成/撤销、今天/近期/全部/完成视图和清单筛选均已通过真实环境验证。
- 2026-07-22 已创建仅云函数可访问的 `weather_cache` 集合及 `uq_weather_cache_key`、`idx_weather_cache_expiry`、`idx_weather_cache_stale_until` 索引，并部署 `weather`、更新后的 `user` 和 `home` 云函数。天气供应商已改为无需密钥的 Open-Meteo 免费开放接口；真实请求和缓存验收见 `docs/weather-home-verification.md`。
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

所有业务云函数均使用：

```ts
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
```

因此同一构建产物部署到开发、测试或生产环境时自动使用函数所在环境，不需要 `SecretId`、`SecretKey` 或天气 API Key。`weather` 与复用天气 adapter 的 `home` 只访问 Open-Meteo 固定官方 host；免费开放接口仅用于非商业用途，部署前应复核每日 10,000 次等限额和 CC BY 4.0 署名要求。供应商不可用时返回受控 `WEATHER_UNAVAILABLE` 或合规陈旧缓存，首页的账目和待办不受影响。

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
| `user_settings` | 默认支付/收款方式、时区和用户偏好 | 仅管理端可读写 |
| `categories` | 默认收入/支出分类 | 仅管理端可读写 |
| `accounts` | 默认固定资金渠道 | 仅管理端可读写 |
| `transactions` | 用户收入/支出事实 | 仅管理端可读写 |
| `todo_lists` | 用户私有待办清单；首次读取由 `todo` 创建默认清单 | 仅管理端可读写 |
| `todos` | 用户待办事实、完成时间和逻辑删除状态 | 仅管理端可读写 |
| `weather_cache` | 服务端共享的标准化天气缓存，不含用户身份或轨迹 | 仅管理端可读写 |
| `data_deletion_requests` | 7 天冷静期、状态、租约和分批删除进度 | 仅管理端可读写 |

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
| `todos` | `uq_todos_owner_request` | `ownerId`, `requestId` | 是 |
| `weather_cache` | `uq_weather_cache_key` | `cacheKey` | 是 |
| `data_deletion_requests` | `uq_data_deletion_owner` | `ownerId` | 是 |

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
| `transactions` | `ownerId` 升序, `isDeleted` 升序, `occurredAt` 降序, `_id` 降序 | 默认混合收支流水、全局稳定排序和复合游标 |
| `transactions` | `ownerId` 升序, `type` 升序, `isDeleted` 升序, `categoryId` 升序, `occurredAt` 降序, `_id` 降序 | 统计分类下钻后的稳定分页 |
| `todo_lists` | `ownerId` 升序, `isEnabled` 升序, `sortOrder` 升序, `_id` 升序 | 可用清单稳定排序 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `createdAt` 降序, `_id` 降序 | 全部待办和复合游标 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `dueDateKey` 升序, `createdAt` 降序, `_id` 降序 | 今日视图 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `status` 升序, `dueDateKey` 升序, `createdAt` 降序, `_id` 降序 | 近期视图 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `status` 升序, `createdAt` 降序, `_id` 降序 | 已完成视图 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `status` 升序, `dueKind` 升序, `dueDateKey` 升序, `createdAt` 降序, `_id` 降序 | 日期型逾期分支 |
| `todos` | `ownerId` 升序, `isDeleted` 升序, `status` 升序, `dueKind` 升序, `dueAt` 升序, `createdAt` 降序, `_id` 降序 | 时间型逾期分支 |
| `weather_cache` | `expiresAt` 升序 | 新鲜缓存过期运维；索引名 `idx_weather_cache_expiry` |
| `weather_cache` | `staleUntil` 升序 | 陈旧缓存物理清理候选；索引名 `idx_weather_cache_stale_until` |
| `data_deletion_requests` | `status`, `cooldownEndsAt` 升序 | 冷静期结束申请；`idx_data_deletion_runnable` |
| `data_deletion_requests` | `status`, `nextRetryAt` 升序 | 失败恢复；`idx_data_deletion_retry` |
| `data_deletion_requests` | `status`, `leaseExpiresAt` 升序 | 执行器租约恢复；`idx_data_deletion_lease` |

索引名称建议分别使用 `idx_categories_owner_id`、`idx_accounts_owner_id`、`idx_transactions_owner_type_active_occurred_id`、`idx_transactions_owner_active_occurred_id` 和 `idx_transactions_owner_type_category_active_occurred_id`，全部为普通非唯一索引。带 `type` 的基础索引用于单类型筛选和按类型聚合；不带 `type` 的索引用于混合结果全局排序；带 `categoryId` 的索引用于分类下钻。不要创建缺少 `_id` 次级排序字段的旧草案索引。控制台若根据真实查询提示无法使用索引，应停止发布、保存提示并回到代码和文档评估，不能改为前端双查询拼接或下载整库。

### 3.4 并发保护

初始化为用户、设置、19 个系统分类和 5 个系统账户生成确定性 `_id`，并在单个服务端事务内按文档 ID 读写。即使唯一索引漏配，同一用户、同一 `systemKey` 的快速并发请求也会竞争同一个文档 ID，不会各自生成随机副本；事务最多重试 3 次。

唯一索引仍是上线必需的数据库完整性防线，可阻止历史脚本或未来其他入口按相同业务键写出重复记录。若目标 CloudBase 环境无法创建上述唯一组合索引，应停止生产发布并记录控制台错误，不能只依赖应用代码宣称约束已完成。

账单创建使用 `ownerId + requestId` 派生确定性 `_id`，并在事务内先读后写。同一请求并发时会竞争同一文档；事务重试后返回已创建记录。`uq_transactions_owner_request` 仍必须建立，避免未来其他写入入口绕过确定性 ID。

收入和支出新增、编辑、逻辑删除只写交易事实；固定渠道只用于归属、存在性和启用状态校验。部署时保留既有集合、索引和“所有用户不可读写”权限，再上传 `user` 和 `ledger`。

## 4. 云函数部署

### 4.1 本地准备

```powershell
npm.cmd install
npm.cmd --prefix cloudfunctions/user install
npm.cmd --prefix cloudfunctions/ledger install
npm.cmd --prefix cloudfunctions/todo install
npm.cmd --prefix cloudfunctions/weather install
npm.cmd --prefix cloudfunctions/home install
npm.cmd run check
npm.cmd run build:cloudfunctions
node -e "require('./cloudfunctions/user/index.js'); require('./cloudfunctions/ledger/index.js'); require('./cloudfunctions/todo/index.js'); require('./cloudfunctions/weather/index.js'); require('./cloudfunctions/home/index.js'); console.log('cloudfunction entries ok')"
```

部署目录必须包含：

- `index.js`；
- `package.json` 和 `package-lock.json`；
- 已生成的对应 `dist/cloudfunctions/<function>/src/**`；
- 不需要上传仓库根目录或本地绝对路径。

`index.js` 加载编译后的 CommonJS 入口，函数名与各目录名一致。选择“云端安装依赖”时由云端读取各函数目录内的 `package.json`；若本地已完整安装依赖并选择“上传并部署：所有文件”，必须确保上传包不含根目录、密钥或无关文件。

### 4.2 开发者工具部署

1. 用微信开发者工具打开包含 `project.config.json` 的仓库根目录。
2. 在工具栏选择正确的开发 CloudBase 环境，确认环境 ID 与 `.env.local` 一致。
3. 确认小程序 AppID 已在目标环境“环境配置 → 安全配置 → 小程序关联”中绑定。
4. 依次右键 `cloudfunctions/user`、`cloudfunctions/ledger`、`cloudfunctions/todo`、`cloudfunctions/weather`、`cloudfunctions/home`，选择与第 4.1 节依赖准备方式匹配的上传部署选项。
5. 确认控制台显示的函数运行时、内存和超时。当前开发环境由微信开发者工具部署为 `Nodejs16.13`、256 MB、10 秒，并已通过真实初始化；不要在未做兼容性回归时直接切换运行时。测试和生产环境应优先评估平台当前提供的较新稳定 Node.js 运行时，并重新执行第 6 节全部场景。
6. 部署完成后在函数列表确认名称为 `user`、`ledger`、`todo`、`weather`、`home`、`dataDeletion` 和 `dataDeletionExecutor`，入口均为 `index.js`，最近版本状态成功；删除执行器配置只存在于云端的 `DATA_DELETION_EXECUTOR_TOKEN`，不得放入小程序环境配置。
7. 重新编译小程序。

统计版部署时先创建 `idx_transactions_owner_type_category_active_occurred_id` 并等待状态可用，再构建和上传 `ledger`、重新编译小程序。统计复用现有 `transactions` 与 `categories`，不创建统计缓存集合，也不需要新增云函数或图表依赖。

不得为云函数添加永久云 API 凭证。流水查询异常会返回受控的 `TRANSACTION_LIST_FAILED` 或 `TRANSACTION_SUMMARY_FAILED`；其他数据库异常返回 `DEPENDENCY_ERROR`。如果平台在超时处直接终止函数，前端会转换为带 `requestId` 的受控错误且不会自动无限重试。

## 5. 开发版诊断

开发版首页显示非敏感初始化诊断：

- 是否成功取得微信身份；
- 是否创建新用户；
- 本次创建的支出分类、收入分类和账户数量；
- 是否已经设置默认支付方式和默认收款方式；
- 是否为完整重复初始化；
- `requestId` 和错误码。

诊断只在 `envVersion = develop` 时显示。体验版和正式版不会显示内部诊断，也不会展示完整 `OPENID`。失败后仅由用户点击重试；应用没有定时器或递归自动重试。

## 6. 端到端验证清单

所有删除、停用和并发测试只允许在开发环境执行。每次验证记录小程序版本、环境 ID 后四位、函数版本、时间、`requestId` 和结果，不记录完整 `OPENID`。

### 场景一：首次进入

1. 使用从未进入该开发环境的微信测试账号打开小程序。
2. 首页诊断应为：身份已获取、新建用户“是”、支出 `11`、收入 `8`、固定渠道 `5`、默认支付/收款方式“已设置”、错误码 `OK`。
3. 在控制台按该条 `users._id` 查询：
   - `users` 新增 1 条；
   - `categories` 中该 `ownerId` 共 19 条，`expense` 11 条、`income` 8 条；
   - `accounts` 中该 `ownerId` 共 5 条；
   - `user_settings.defaultExpenseAccountId` 和 `defaultIncomeAccountId` 均指向同一 `ownerId` 且 `systemKey = account_wechat` 的固定渠道。

### 场景二：重复进入

1. 记录四个集合的数量和当前默认支付/收款方式。
2. 关闭小程序后重新进入，或在开发者工具重新编译。
3. 首页诊断应显示各创建数量为 `0`，重复初始化“是”。
4. 确认用户、分类、固定渠道数量未增加，两个默认渠道未改变，`lastLoginAt` 晚于首次调用。

### 场景三：部分数据缺失

1. 备份当前开发账号数据。
2. 在控制台删除一个系统分类，重新进入；确认只补回 1 个对应分类。
3. 删除一个非默认固定渠道，重新进入；确认只补回 1 个固定渠道。
4. 不得通过本场景删除用户当前默认支付或收款渠道。确认其他分类、渠道名称、启用状态和默认设置未被覆盖。

### 场景四：多用户隔离

1. 分别用两个微信测试账号进入同一开发环境。
2. 确认产生两个不同 `users._id`，各自有 19 个分类、5 个账户和 1 条设置。
3. 两名用户的默认支付和收款方式分别指向本人的微信渠道，不得交叉。
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

2026-07-21 至 2026-07-22 在微信开发者工具和开发环境 CloudBase 控制台完成以下验证。记录不包含完整 `OPENID` 或其他敏感信息。

- 已创建 `users`、`user_settings`、`categories`、`accounts` 四个集合，并将客户端权限设置为“所有用户不可读写”。
- 已创建 `transactions` 集合，并确认 `transactions`、`categories`、`accounts` 的客户端权限均为“所有用户不可读写”。
- 已创建第 3.2 节列出的用户、设置、分类、账户、交易、待办和天气缓存唯一索引。
- 已创建 `uq_transactions_owner_request` 唯一索引，以及 `idx_transactions_owner_type_active_occurred_id`、`idx_transactions_owner_active_occurred_id`、`idx_categories_owner_id`、`idx_accounts_owner_id` 流水查询索引；字段顺序和升降序与第 3.3 节一致，索引均已可用。
- 已部署 `user` 云函数并启用开发环境日志服务。
- 已于 2026-07-21 22:58 部署包含 `listTransactions` 的 `ledger` 云函数。云端测试在无微信调用上下文时返回受控 `UNAUTHENTICATED`，证明新入口已生效且不会信任测试请求伪造身份；日志记录了一次约 604 ms 的冷启动。
- 已于 2026-07-22 11:16:43 重新部署包含收入完整闭环和混合流水查询的 `ledger` 云函数，控制台状态为“已部署”；上传包为 41.9 KB、32 个文件。随后重新编译小程序，真实微信上下文下“账单流水”的“全部”筛选成功返回数据，月度收入、支出和结余汇总正确展示，控制台未出现业务错误。
- 2026-07-22 用户完成并确认收入完整闭环清单全部通过，包括新增、编辑、跨月编辑、删除、筛选与汇总联动、幂等与并发保护、用户隔离、混合分页、失败重试和支出回归；详细结论见 `docs/income-transaction-verification.md`。
- 云函数实际配置已复核为 `Nodejs16.13`、256 MB；`user`、`weather`、`home` 为 15 秒超时，其他已部署业务函数保持 10 秒。Open-Meteo adapter 不需要业务密钥环境变量。运行时升级留作独立兼容性任务。
- 首次进入成功：身份已获取、新建用户 1、支出分类 11、收入分类 8、固定渠道 5、默认支付/收款方式已设置、错误码 `OK`。
- 控制台计数确认：`users` 1 条、`user_settings` 1 条、`categories` 19 条、`accounts` 5 条。
- 重复进入成功：新建用户为否，分类和账户新增数均为 0，重复初始化为是，错误码 `OK`；集合记录数未增加，`lastLoginAt` 已更新。
- 真实调用曾暴露 CloudBase 会注入顶层运行时元数据；入口现只读取协议字段，同时仍明确拒绝调用方伪造的 `userId`、`ownerId` 和各种 `openId` 字段。修复后已重新部署并通过真实调用。
- 微信开发者工具完成真实 GUI 编译后，开发账号的 2026 年 7 月流水页成功展示原有两笔餐饮支出 `¥15.00`、`¥12.50`，并写入 20 笔 `¥0.01` 的开发分页验收记录。全月 22 笔、月度汇总 `¥27.70`；7 月 21 日 21 笔且跨页合并后小计 `¥27.69`，7 月 20 日 1 笔且小计 `¥0.01`。
- 首次只加载 20 条，月度汇总已经包含全月 22 条；上拉后第二页无重复、无遗漏并显示“没有更多了”。下拉刷新后再次分页得到相同结果。
- 通过开发者工具运行时的一次性调用代理验证第二页失败状态：第一页和汇总保留、显示明确重试入口；代理在拒绝前自动恢复，点击重试后真实 CloudBase 请求成功。最终重新编译清除调试状态，开发者工具为 `Errors: 0`、`Problems: 0`。
- 2026-07-22 已创建 `todo_lists`、`todos` 和待办业务索引，部署 `todo` 云函数（控制台更新时间 14:00:57）。真实微信上下文验证了首次默认清单、空态、新增、编辑、完成/撤销、今天/近期/全部/完成视图及默认清单筛选；新增一条标题以“验证真实云函数”开头的日期型开发验收任务并保留为待处理状态。
- 2026-07-22 已创建 `weather_cache`，客户端权限为“所有用户不可读写”，三个天气缓存索引均已可用；`weather`、`home` 和支持设置读写的 `user` 已部署。发现运行时为 `Nodejs16.13` 后，天气 HTTP adapter 改用 `node:https` 并重新部署，避免依赖 Node 18 才提供的全局 `fetch`。
- 微信开发者工具模拟器已验证 `home.getOverview` 真实调用成功：未选择城市时天气模块显示城市选择入口，今日待办和今日/本月收支仍正常展示；天气详情页保留手动搜索、用户主动定位、拒绝说明和重新授权入口。完整记录见 `docs/weather-home-verification.md`。
- 2026-07-28 在开发环境 `cloud1`（`cloud1-d1gs4h1yj714bd6bc`）创建 `data_deletion_requests`，客户端权限设为“所有用户不可读写”，并创建 `uq_data_deletion_owner`、`idx_data_deletion_runnable`、`idx_data_deletion_retry`、`idx_data_deletion_lease` 四个索引；`user_settings` 的禁止客户端读写权限和 `uq_user_settings_owner` 唯一索引复核通过。
- 同日通过微信开发者工具部署 `dataDeletion`、`dataDeletionExecutor`，并更新 `ledger`、`user`；刷新后七个统一业务函数均显示“已部署”。云端不存在余额、账户管理或转账函数，也不存在 `account_balance_mutations` 集合，未执行删除操作。
- `dataDeletionExecutor` 当前保持无执行令牌的关闭状态，所有执行请求都会被代码拒绝；未创建定时触发器、未调用执行器、未删除真实用户数据。其控制台超时当前为 3 秒，后续专门验收前需要配置云端令牌并提高超时。

以下场景尚未在真实环境完成，不应标记为通过：

- 场景三“部分数据缺失”需要删除开发环境记录，属于破坏性验证，执行前需再次确认并先记录待恢复数据。
- 场景四“多用户隔离”需要第二个微信测试账号。
- 场景五的真实并发调用尚未执行；确定性文档 ID、唯一索引和本地并发测试已形成三层保护，但不能代替云端并发实测。
- 流水页 21 笔以上的第二页加载、跨分页同日合并、多日小计、刷新后重新分页和第二页失败重试均已完成真实开发者工具验证。20 笔一分钱开发测试记录暂时保留到多用户隔离验收完成；后续清理必须按精确交易 ID 执行并在删除前再次确认。
- 测试环境和生产环境尚未创建或切换；正式发布前应重复集合、权限、索引、函数部署和全部端到端验证。
- 设置与删除申请尚未进行真实微信账号的申请/撤销验收；旧 `user_settings` 迁移要在用户下次初始化时验证。删除执行器的令牌、超时、定时触发、失败告警和恢复流程留待后续专门任务，并需要再次取得明确授权。

## 10. 参考资料

- [微信小程序调用 CloudBase 云函数](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- [CloudBase 数据库权限模式](https://docs.cloudbase.net/recipes/add-database-wechat-miniprogram)
- [CloudBase 索引管理](https://docs.cloudbase.net/database/data-index)
- [CloudBase 事务](https://docs.cloudbase.net/database/transaction)
- [CloudBase 云函数运行时](https://docs.cloudbase.net/cloud-function/runtime-support)

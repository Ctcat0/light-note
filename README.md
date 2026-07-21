# 轻记

轻记是一个微信原生 TypeScript 小程序项目。当前仓库包含可运行工程骨架、用户初始化，以及收入和支出新增、按类型和月份查看、编辑、逻辑删除的最小闭环；转账、账户余额、预算、待办和天气业务尚未实现，也不包含模拟业务数据。收支闭环已通过本地自动检查；收入能力需要重新部署 `ledger` 后才能在真实 CloudBase 环境生效，本次按用户要求跳过该人工验收。

## 目录

```text
.
├─ miniprogram/          # 微信小程序前端
│  ├─ pages/             # 首页、记账、待办、我的
│  ├─ components/        # loading、empty、error-state
│  ├─ config/            # 前端公开环境配置
│  ├─ constants/         # 云函数名和错误码
│  ├─ services/          # CloudBase 调用封装
│  ├─ types/             # 前端类型与统一 API 类型导出
│  └─ utils/             # 金额、日期和错误工具
├─ cloudfunctions/       # CloudBase 云函数根目录
├─ shared/types/         # 前后端共享的云函数契约
├─ tests/                # 基础工具与项目结构测试
└─ docs/                 # 需求与技术设计
```

## 环境要求

- 微信开发者工具；
- Node.js 20 或更高版本；
- npm 10 或更高版本；
- 一个已开通云开发的微信小程序 AppID 和对应 CloudBase 开发环境（仅在调用云能力时需要）。

## 安装与检查

首次拉取后在项目根目录运行：

```powershell
npm.cmd install
npm.cmd --prefix cloudfunctions/user install
npm.cmd --prefix cloudfunctions/ledger install
npm.cmd run configure:env
npm.cmd run check
```

可单独执行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

`build` 当前执行 TypeScript 与 ESLint 验证；小程序实际编译和预览由微信开发者工具的 TypeScript 编译插件完成。

## 在微信开发者工具中启动

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本仓库根目录，即包含 `project.config.json` 的目录。
3. 需要 CloudBase 时，使用已经关联目标环境的小程序 AppID。
4. 确认项目设置已启用 TypeScript 编译插件，然后编译。
5. 编译后应能看到“首页、记账、待办、我的”四个底部导航页面。

## 配置 CloudBase 环境

复制示例文件并填写本机环境 ID：

```powershell
Copy-Item .env.example .env.local
npm.cmd run configure:env
```

开发版、体验版和正式版分别读取 `.env.local` 中的 `CLOUD_ENV_ID_DEVELOPMENT`、`CLOUD_ENV_ID_TEST` 和 `CLOUD_ENV_ID_PRODUCTION`。CloudBase 环境 ID 是前端可公开标识，不是云 API 凭证；`.env.local` 和生成的 `environment.runtime.ts` 均被 Git 忽略。生产发布应由发布机环境变量生成配置，不在源码中写死正式环境 ID。

当前已实现 `user.init`，以及 `ledger` 的启用收支分类/账户查询、`createTransaction`、`getTransaction`、`listTransactions`、`getMonthlySummary`、`updateTransaction` 和 `deleteTransaction`。首页通过独立月度汇总接口展示本月收入、支出和结余，并提供收入/支出快捷入口；底部“记账”页可切换收支类型及历史月份，支持下拉刷新和上拉分页。目标环境未配置、查询索引缺失或云函数未重新部署时，页面会进入可重试错误状态；页面不会直接访问数据库。

部署前执行：

```powershell
npm.cmd --prefix cloudfunctions/user install
npm.cmd --prefix cloudfunctions/ledger install
npm.cmd run build:cloudfunctions
```

然后在微信开发者工具中依次右键 `cloudfunctions/user`、`cloudfunctions/ledger`，选择“上传并部署：云端安装依赖”。首次部署前还必须按 [`docs/database-setup.md`](docs/database-setup.md) 创建集合、权限和索引；新增支出按 [`docs/transaction-verification.md`](docs/transaction-verification.md) 验收，流水列表按 [`docs/transaction-list-verification.md`](docs/transaction-list-verification.md) 验收，编辑与逻辑删除按 [`docs/transaction-mutation-verification.md`](docs/transaction-mutation-verification.md) 验收。

## 密钥与数据安全

- 天气 API Key、AppSecret、SecretId、SecretKey 等只能配置在云函数环境变量或受控云端密钥配置中。
- 不要把真实密钥写入 `.env.local`、环境配置、`project.config.json`、README、测试或任何小程序前端文件。
- 页面不得调用 `wx.cloud.database()`；业务数据统一经 service 调用云函数。
- 当前实现不读取用户资料、不请求位置权限；账单备注只在用户提交后由云函数写入本人数据，不写入日志。

## 后续开发约束

业务开发前请先阅读 `AGENTS.md`、`docs/architecture.md`、`docs/data-model.md` 和 `docs/api-design.md`。新增云函数必须从可信微信上下文取得身份，按 `ownerId` 隔离用户数据，并使用 `shared/types/api.ts` 约定的返回结构。

# 轻记

轻记是一个微信原生 TypeScript 小程序项目。当前仓库包含用户初始化、收入/支出完整闭环、混合流水、统计分析、Todo List、Open-Meteo 天气代理与缓存、首页聚合、设置与隐私，以及带 7 天冷静期的个人数据删除申请。微信、支付宝、银行卡、现金和其他仅作为固定支付/收款渠道。收支、Todo、天气降级与首页聚合已在真实开发环境完成相应验收；设置、统计和数据删除仍待统一 CloudBase 验收。

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
npm.cmd --prefix cloudfunctions/todo install
npm.cmd --prefix cloudfunctions/weather install
npm.cmd --prefix cloudfunctions/home install
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

当前已实现 `user.init/getSettings/updateSettings`、`ledger` 收支与统计 actions、`todo` 完整闭环、`weather.searchLocations/getWeather` 和 `home.getOverview`。天气支持手动城市、用户主动定位、15 分钟实时缓存、2 小时预报缓存及供应商失败时的陈旧缓存降级；首页并行聚合今日/本月收支、今日/逾期待办和天气，并允许单模块失败。目标环境未配置、查询索引缺失或云函数未重新部署时，页面会进入可重试或模块级降级状态；页面不会直接访问数据库或天气供应商。

部署前执行：

```powershell
npm.cmd --prefix cloudfunctions/user install
npm.cmd --prefix cloudfunctions/ledger install
npm.cmd --prefix cloudfunctions/todo install
npm.cmd --prefix cloudfunctions/weather install
npm.cmd --prefix cloudfunctions/home install
npm.cmd run build:cloudfunctions
```

然后在微信开发者工具中依次部署 `cloudfunctions/user`、`cloudfunctions/ledger`、`cloudfunctions/todo`、`cloudfunctions/weather` 和 `cloudfunctions/home`。首次部署前还必须按 [`docs/database-setup.md`](docs/database-setup.md) 创建集合、权限、索引并核对云函数配置；待办按 [`docs/todo-verification.md`](docs/todo-verification.md) 验收，天气与首页按 [`docs/weather-home-verification.md`](docs/weather-home-verification.md) 验收。Open-Meteo adapter 不需要天气环境变量或 API Key。

## 密钥与数据安全

- 天气 API Key、AppSecret、SecretId、SecretKey 等只能配置在云函数环境变量或受控云端密钥配置中。
- 不要把真实密钥写入 `.env.local`、环境配置、`project.config.json`、README、测试或任何小程序前端文件。
- 页面不得调用 `wx.cloud.database()`；业务数据统一经 service 调用云函数。
- 当前实现不读取用户资料；位置权限只会在用户主动点击“使用当前位置”后请求，拒绝后仍可手动选择城市并继续使用记账与待办。精确坐标不落库、不写日志，账单备注也不写入日志。

## 后续开发约束

业务开发前请先阅读 `AGENTS.md`、`docs/architecture.md`、`docs/data-model.md` 和 `docs/api-design.md`。新增云函数必须从可信微信上下文取得身份，按 `ownerId` 隔离用户数据，并使用 `shared/types/api.ts` 约定的返回结构。

# 轻记

轻记是一个微信原生 TypeScript 小程序项目。当前仓库只包含可运行的工程骨架、四个一级页面、公共状态组件和基础工具，不包含账单、待办、天气或用户设置的完整业务实现，也不包含模拟业务数据。

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
3. 初次查看静态骨架可以使用配置中的游客 AppID；需要 CloudBase 时，在开发者工具中换成自己的小程序 AppID。
4. 确认项目设置已启用 TypeScript 编译插件，然后编译。
5. 编译后应能看到“首页、记账、待办、我的”四个底部导航页面。

## 配置 CloudBase 开发环境

编辑 `miniprogram/config/environment.ts`：

```ts
export const environment: EnvironmentConfig = {
  name: "development",
  cloudEnvId: "你的开发环境 ID",
  enableCloud: true,
};
```

CloudBase 环境 ID 是前端可用的环境标识，不是天气服务密钥。开发、测试、生产环境应使用不同环境 ID。

当前仓库尚未创建业务云函数。环境未配置时，小程序仍可打开静态骨架；CloudBase 调用封装会返回明确的未配置错误。

## 密钥与数据安全

- 天气 API Key、AppSecret、SecretId、SecretKey 等只能配置在云函数环境变量或受控云端密钥配置中。
- 不要把真实密钥写入 `environment.ts`、`project.config.json`、README、测试或任何小程序前端文件。
- 页面不得调用 `wx.cloud.database()`；业务数据统一经 service 调用云函数。
- 当前骨架不读取用户资料、不请求位置权限，也不包含真实用户数据。

## 后续开发约束

业务开发前请先阅读 `AGENTS.md`、`docs/architecture.md`、`docs/data-model.md` 和 `docs/api-design.md`。新增云函数必须从可信微信上下文取得身份，按 `ownerId` 隔离用户数据，并使用 `shared/types/api.ts` 约定的返回结构。

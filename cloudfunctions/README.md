# CloudBase 云函数目录

本目录按 `user`、`ledger`、`todo`、`weather`、`home`、`dataDeletion` 和 `dataDeletionExecutor` 业务域逐项创建云函数。当前已实现用户初始化和分组设置、完整收支、待办、天气、首页聚合，以及带 7 天冷静期的个人数据删除申请与受保护分批执行器，并遵循：

- 从 `cloud.getWXContext().OPENID` 获取可信微信身份；
- 所有用户数据查询和修改均校验 `ownerId`；
- 返回结构与 `shared/types/api.ts` 一致；
- 天气 adapter 只访问代码中固定的 Open-Meteo 官方 host，不需要 API Key；
- 每个云函数独立安装其实际需要的依赖，不共享隐式的根目录运行时依赖。

`user` 和 `ledger` 云函数使用 TypeScript 源码。首次拉取后分别运行 `npm.cmd --prefix cloudfunctions/user install`、`npm.cmd --prefix cloudfunctions/ledger install` 安装依赖，再从仓库根目录运行 `npm.cmd run build:cloudfunctions` 生成各自的本地 `dist`。在微信开发者工具中依次对两个函数选择“上传并部署：云端安装依赖”，部署名称必须与目录名一致，超时设置为 10 秒。运行时切换必须先完成兼容性回归。

函数通过 `cloud.DYNAMIC_CURRENT_ENV` 使用部署目标环境及平台默认服务身份，不读取 SecretId、SecretKey 或本地环境变量。每个部署包只包含自己的函数目录，因此部署前必须确认对应 `dist/` 已生成。当前依赖固定为 `wx-server-sdk@3.0.1`；弃用提示、安全审计结论与升级条件见 [`docs/database-setup.md`](../docs/database-setup.md)。

具体分层、字段和 action 见 `docs/architecture.md`、`docs/data-model.md` 和 `docs/api-design.md`。

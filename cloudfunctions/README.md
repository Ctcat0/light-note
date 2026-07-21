# CloudBase 云函数目录

本目录暂不包含占位业务云函数。后续云函数按 `user`、`ledger`、`todo`、`weather`、`home` 业务域逐项创建，并遵循：

- 从 `cloud.getWXContext().OPENID` 获取可信微信身份；
- 所有用户数据查询和修改均校验 `ownerId`；
- 返回结构与 `shared/types/api.ts` 一致；
- 天气服务密钥只配置在云函数环境变量中；
- 每个云函数独立安装其实际需要的依赖，不共享隐式的根目录运行时依赖。

具体分层、字段和 action 见 `docs/architecture.md`、`docs/data-model.md` 和 `docs/api-design.md`。

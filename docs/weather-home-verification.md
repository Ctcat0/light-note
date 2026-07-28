# T8 天气与 T9 首页聚合验收记录

## 1. 范围

本记录覆盖：

- `weather.searchLocations`、`weather.getWeather` 与 Open-Meteo adapter；
- 手动城市选择、用户主动定位及定位拒绝后的降级说明；
- `weather_cache` 新鲜缓存、陈旧缓存和不可用状态；
- `user.getSettings/updateSettings` 的默认城市保存；
- `home.getOverview` 对天气、今日/本月收支、今日/逾期待办的模块级聚合；
- 首页本地快照、局部重试和快捷入口。

小时预报、天气与户外任务联动、基础预算不在本次范围。

## 2. 安全与隐私结论

- 小程序端只调用 service，不直接访问 CloudBase 数据库或 Open-Meteo。
- Open-Meteo Forecast 与 Geocoding host 固定在云函数 adapter 内，无需 API Key；仓库、前端响应和日志不包含天气凭据。
- 所有天气 action 先从可信微信上下文解析当前用户，并按用户限流，客户端不能把云函数作为任意网络代理。
- 城市关键字限制为 1 至 40 字；坐标先校验范围，再降到小数点后 2 位；任意 host 和供应商参数不能由客户端传入。
- `wx.getLocation` 只在用户主动点击“使用当前位置”后调用，使用 WGS84 坐标。`app.json` 声明用途与 `requiredPrivateInfos`；拒绝后页面提供手动搜索和打开设置重新授权入口，且记账与待办仍可使用。服务端只保留降精度后的默认位置，不保存轨迹或记录原始精确坐标。
- `weather_cache` 是不含 `ownerId`、微信身份或位置轨迹的共享服务端缓存，客户端权限为“所有用户不可读写”。

## 3. 缓存规则

| 类型 | 新鲜 TTL | 供应商失败后的最大陈旧窗口 |
| --- | ---: | ---: |
| 当前天气 | 15 分钟 | 6 小时 |
| 三日预报 | 2 小时 | 24 小时 |

同一位置的新鲜缓存直接返回 `fresh`；成功刷新返回 `refreshed`；供应商失败且旧记录仍在陈旧窗口内返回 `stale` 并暴露更新时间；没有合规旧缓存时返回 `WEATHER_UNAVAILABLE`。当前天气和三日预报分别缓存，任一刷新失败都不得把过期窗口外的数据伪装成实时数据。

## 4. 自动化验证

根目录执行：

```powershell
npm.cmd run check
npm.cmd run build:cloudfunctions
git diff --check
```

测试覆盖：

- 城市关键字、坐标范围、坐标降精度和 Open-Meteo 坐标位置标识；
- 新鲜缓存命中不调用供应商；
- 当前天气与三日预报的独立 TTL；
- 供应商失败时的 `stale` 返回与陈旧窗口外失败；
- 无身份、未初始化用户、限流和供应商错误；
- 默认城市更新的版本冲突、跨用户归属和前端响应解析；
- 首页只允许请求用户时区下的今天；
- 天气模块失败时账目和待办模块保持成功；
- 前端 service 的严格响应解析和受控错误转换。

## 5. CloudBase 开发环境验证

2026-07-22 在微信开发者工具关联的免费开发环境完成：

- 创建 `weather_cache`，权限设为“所有用户不可读写”；
- 创建并确认可用：`uq_weather_cache_key`（唯一）、`idx_weather_cache_expiry`、`idx_weather_cache_stale_until`；
- 部署 `weather`、更新后的 `user` 与 `home`；
- 发现函数运行时为 `Nodejs16.13` 后，将天气 HTTP 调用改为 `node:https`，重新构建并重新部署 `weather` 与 `home`；
- 将 `user`、`weather`、`home` 执行超时统一调整为 15 秒；
- 模拟器重新加载首页后，`home.getOverview` 不再出现 `FUNCTION_NOT_FOUND`；
- 未选择城市时，首页天气卡片显示城市选择入口，今日待办与今日/本月收支同时正常展示；
- 进入天气页后可见手动搜索、用户主动定位和未选城市空态；搜索“北京”真实返回北京、重庆、成都三个候选结果；
- 选择“北京 · 北京市 · 中国”后，真实 Forecast 请求返回 `28.3°C`、雷暴和三日预报，页面标明“天气数据：Open-Meteo”，更新时间为 15:41；
- 15:43 再次进入天气页时仍返回同一 15:41 更新时间和相同预报，确认命中新鲜缓存而非再次刷新供应商；首页聚合卡片同步显示同一城市、温度、天气和更新时间；
- 首次保存城市暴露了 CloudBase `update` 在 `defaultLocation: null` 上创建嵌套路径的 `PathNotVisible` 错误，已改为事务内整文档覆盖并新增适配器回归测试；
- 受控集成测试已验证供应商断网/失败时：陈旧窗口内返回 `cacheStatus = stale`，窗口外返回 `WEATHER_UNAVAILABLE`，未在共享开发环境人为断网或破坏缓存。

## 6. 尚未完成的人工与多环境场景

- 未通过 Windows 自动化接受或修改位置隐私权限；真机的首次授权、拒绝、系统设置撤销和重新授权需由测试者按隐私流程人工验证。
- 第二个微信账号的跨用户设置隔离、云端跨实例限流和测试/生产环境部署尚未验证。
- 基础预算已延期，`home.getOverview.ledger.data.budget` 当前为 `null`，首页不展示预算。

## 7. 供应商配置参考

- [Open-Meteo Forecast API](https://open-meteo.com/en/docs)
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- [Open-Meteo 免费与商业使用限制](https://open-meteo.com/en/pricing)

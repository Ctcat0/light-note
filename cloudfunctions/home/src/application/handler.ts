import type { ApiErrorCode, ApiResponse } from "../../../../shared/types/api";
import type { HomeOverviewResult } from "../../../../shared/types/home";
import type { WeatherProvider, WeatherStore } from "../../../weather/src/domain/types";
import type { HomeStore } from "../domain/types";
import { getHomeOverview } from "./overview";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
class HomeError extends Error { constructor(readonly code: ApiErrorCode, message: string) { super(message); } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function createHomeFunctionHandler(dependencies: {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: HomeStore;
  weatherStore: WeatherStore;
  provider: WeatherProvider;
}): (event: unknown) => Promise<ApiResponse<HomeOverviewResult>> {
  return async (event) => {
    const now = dependencies.getCurrentTime();
    const requestId = isRecord(event) && typeof event.requestId === "string" ? event.requestId.slice(0, 128) : `server-${Date.now().toString(36)}`;
    try {
      if (!isRecord(event) || event.action !== "getOverview" || typeof event.requestId !== "string" || !UUID_PATTERN.test(event.requestId) || !isRecord(event.payload)) throw new HomeError("INVALID_ARGUMENT", "首页请求格式无效");
      if (["ownerId", "userId", "openId", "openid", "OPENID"].some((key) => Object.prototype.hasOwnProperty.call(event, key))) throw new HomeError("INVALID_ARGUMENT", "请求包含不可信身份字段");
      const keys = Object.keys(event.payload);
      if (keys.some((key) => key !== "dateKey") || (event.payload.dateKey !== undefined && (typeof event.payload.dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(event.payload.dateKey)))) throw new HomeError("INVALID_ARGUMENT", "首页日期参数无效");
      const openId = dependencies.getOpenId();
      if (!openId?.trim()) throw new HomeError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
      const user = await dependencies.store.findUserByOpenId(openId);
      if (user === null) throw new HomeError("USER_NOT_INITIALIZED", "请先完成用户初始化");
      if (user.status !== "active") throw new HomeError("USER_DISABLED", "当前用户不可用");
      const settings = await dependencies.store.getSettingsByOwner(user._id);
      if (settings === null || settings.ownerId !== user._id) throw new HomeError("USER_NOT_INITIALIZED", "用户设置尚未初始化");
      let data: HomeOverviewResult;
      try {
        data = await getHomeOverview({
          ownerId: user._id,
          settings,
          ...(typeof event.payload.dateKey === "string" ? { requestedDateKey: event.payload.dateKey } : {}),
          now,
          store: dependencies.store,
          weatherStore: dependencies.weatherStore,
          provider: dependencies.provider,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_DATE") throw new HomeError("INVALID_ARGUMENT", "首页只允许查询今天");
        throw error;
      }
      return { success: true, code: "OK", message: "首页加载成功", data, requestId: event.requestId, serverTime: now.toISOString() };
    } catch (error) {
      const known = error instanceof HomeError ? error : new HomeError("DEPENDENCY_ERROR", "首页暂时不可用，请稍后重试");
      return { success: false, code: known.code, message: known.message, data: null, requestId, serverTime: now.toISOString() };
    }
  };
}

import type { ApiErrorCode, ApiResponse } from "../../../../shared/types/api";
import type {
  GetWeatherRequest,
  SearchLocationsRequest,
  SearchLocationsResult,
  WeatherResult,
} from "../../../../shared/types/weather";
import type { WeatherProvider, WeatherStore } from "../domain/types";
import { WeatherError } from "../domain/types";
import {
  getWeatherForSettings,
  resolveWeatherUser,
  searchLocations,
} from "./weather";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type WeatherResponseData = SearchLocationsResult | WeatherResult;

interface WeatherFunctionDependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: WeatherStore;
  provider: WeatherProvider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && keys.every((key) => allowed.includes(key));
}

function extractRequestId(event: unknown): string {
  return isRecord(event) && typeof event.requestId === "string" ? event.requestId.slice(0, 128) : `server-${Date.now().toString(36)}`;
}

function parseBase(event: unknown): { action: string; requestId: string; payload: Record<string, unknown> } {
  if (!isRecord(event)) throw new WeatherError("INVALID_ARGUMENT", "请求格式无效");
  if (["ownerId", "userId", "openId", "openid", "OPENID"].some((key) => Object.prototype.hasOwnProperty.call(event, key))) {
    throw new WeatherError("INVALID_ARGUMENT", "请求包含不可信身份字段");
  }
  if (typeof event.action !== "string" || !isRecord(event.payload)) throw new WeatherError("INVALID_ARGUMENT", "请求格式无效");
  if (typeof event.requestId !== "string" || !UUID_PATTERN.test(event.requestId)) throw new WeatherError("REQUEST_ID_REQUIRED", "requestId 必须是 UUID");
  return { action: event.action, requestId: event.requestId, payload: event.payload };
}

function parseSearch(value: Record<string, unknown>): SearchLocationsRequest {
  if (value.mode === "keyword" && exact(value, ["mode", "keyword"], ["mode", "keyword"]) && typeof value.keyword === "string") {
    return { mode: "keyword", keyword: value.keyword };
  }
  if (value.mode === "coordinates" && exact(value, ["mode", "latitude", "longitude"], ["mode", "latitude", "longitude"]) && typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { mode: "coordinates", latitude: value.latitude, longitude: value.longitude };
  }
  throw new WeatherError("INVALID_ARGUMENT", "城市搜索参数无效");
}

function parseGetWeather(value: Record<string, unknown>): GetWeatherRequest {
  if (!exact(value, ["locationKey"], []) || (value.locationKey !== undefined && typeof value.locationKey !== "string")) {
    throw new WeatherError("INVALID_ARGUMENT", "天气查询参数无效");
  }
  return value.locationKey === undefined ? {} : { locationKey: value.locationKey };
}

function success(data: WeatherResponseData, requestId: string, now: Date): ApiResponse<WeatherResponseData> {
  return { success: true, code: "OK", message: "操作成功", data, requestId, serverTime: now.toISOString() };
}

function failure(code: ApiErrorCode, message: string, requestId: string, now: Date): ApiResponse<WeatherResponseData> {
  return { success: false, code, message, data: null, requestId, serverTime: now.toISOString() };
}

export function createWeatherFunctionHandler(dependencies: WeatherFunctionDependencies): (event: unknown) => Promise<ApiResponse<WeatherResponseData>> {
  const rateBuckets = new Map<string, number[]>();
  function checkRate(ownerId: string, action: string, now: Date): void {
    const key = `${ownerId}:${action}`;
    const threshold = action === "searchLocations" ? 10 : 30;
    const recent = (rateBuckets.get(key) ?? []).filter((value) => value > now.getTime() - 60_000);
    if (recent.length >= threshold) throw new WeatherError("RATE_LIMITED", "天气请求过于频繁，请稍后重试");
    recent.push(now.getTime());
    rateBuckets.set(key, recent);
  }

  return async (event) => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId = extractRequestId(event);
    try {
      const request = parseBase(event);
      const identity = await resolveWeatherUser(dependencies.getOpenId(), dependencies.store);
      checkRate(identity.ownerId, request.action, now);
      let data: WeatherResponseData;
      if (request.action === "searchLocations") {
        data = await searchLocations({ payload: parseSearch(request.payload), provider: dependencies.provider });
      } else if (request.action === "getWeather") {
        const payload = parseGetWeather(request.payload);
        data = await getWeatherForSettings({
          ...(payload.locationKey === undefined ? {} : { locationKey: payload.locationKey }),
          settings: identity.settings,
          now,
          store: dependencies.store,
          provider: dependencies.provider,
        });
      } else {
        throw new WeatherError("INVALID_ARGUMENT", "未知的天气操作");
      }
      return success(data, request.requestId, now);
    } catch (error) {
      if (error instanceof WeatherError) return failure(error.code, error.message, fallbackRequestId, now);
      return failure("WEATHER_UNAVAILABLE", "天气服务暂时不可用，请稍后重试", fallbackRequestId, now);
    }
  };
}

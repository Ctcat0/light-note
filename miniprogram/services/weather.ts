import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type {
  CurrentWeather,
  DailyWeather,
  GetWeatherRequest,
  SearchLocationsRequest,
  SearchLocationsResult,
  WeatherLocation,
  WeatherResult,
} from "../types/weather";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import { callCloudFunction, type CloudCallOptions } from "./cloud";

const WEATHER_SNAPSHOT_KEY = "weather_snapshot_v1";

interface StorageApi {
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;
}

function getDefaultStorage(): StorageApi | null {
  const candidate =
    typeof wx === "undefined" ? null : (wx as unknown as Partial<StorageApi>);
  if (
    candidate === null ||
    typeof candidate.setStorageSync !== "function" ||
    typeof candidate.removeStorageSync !== "function"
  ) {
    return null;
  }
  return candidate as StorageApi;
}

export type WeatherTransport = <TPayload extends object, TData>(options: CloudCallOptions<TPayload, TData>) => Promise<TData>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseWeatherLocation(value: unknown): WeatherLocation {
  if (!isRecord(value) || typeof value.locationKey !== "string" || typeof value.displayName !== "string" || (value.adminArea !== null && typeof value.adminArea !== "string") || typeof value.countryCode !== "string") {
    throw new Error("城市响应格式无效");
  }
  return { locationKey: value.locationKey, displayName: value.displayName, adminArea: value.adminArea, countryCode: value.countryCode };
}

function parseCurrent(value: unknown): CurrentWeather {
  if (!isRecord(value) || !finite(value.temperatureCelsius) || (value.apparentTemperatureCelsius !== null && !finite(value.apparentTemperatureCelsius)) || typeof value.conditionCode !== "string" || typeof value.conditionText !== "string" || (value.humidityPercent !== null && !finite(value.humidityPercent)) || (value.windDirection !== null && typeof value.windDirection !== "string") || (value.windScale !== null && typeof value.windScale !== "string") || (value.precipitationProbabilityPercent !== null && !finite(value.precipitationProbabilityPercent))) {
    throw new Error("实时天气响应格式无效");
  }
  return value as unknown as CurrentWeather;
}

function parseDaily(value: unknown): DailyWeather {
  if (!isRecord(value) || typeof value.dateKey !== "string" || !finite(value.minTemperatureCelsius) || !finite(value.maxTemperatureCelsius) || typeof value.conditionCode !== "string" || typeof value.conditionText !== "string" || (value.precipitationProbabilityPercent !== null && !finite(value.precipitationProbabilityPercent))) {
    throw new Error("天气预报响应格式无效");
  }
  return value as unknown as DailyWeather;
}

export function parseWeatherResult(value: unknown): WeatherResult {
  if (!isRecord(value) || !Array.isArray(value.daily) || typeof value.observedAt !== "string" || typeof value.fetchedAt !== "string" || (value.cacheStatus !== "fresh" && value.cacheStatus !== "refreshed" && value.cacheStatus !== "stale") || typeof value.provider !== "string") {
    throw new Error("天气响应格式无效");
  }
  return {
    location: parseWeatherLocation(value.location),
    current: parseCurrent(value.current),
    daily: value.daily.map(parseDaily),
    observedAt: value.observedAt,
    fetchedAt: value.fetchedAt,
    cacheStatus: value.cacheStatus,
    provider: value.provider,
  };
}

export function parseSearchLocationsResult(value: unknown): SearchLocationsResult {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("城市搜索响应格式无效");
  return { items: value.items.map(parseWeatherLocation) };
}

export function saveWeatherSnapshot(
  data: WeatherResult,
  storage: StorageApi | null = getDefaultStorage(),
): void {
  storage?.setStorageSync(WEATHER_SNAPSHOT_KEY, {
    data,
    savedAt: new Date().toISOString(),
  });
}

export function clearWeatherLocalCache(
  storage: StorageApi | null = getDefaultStorage(),
): void {
  storage?.removeStorageSync(WEATHER_SNAPSHOT_KEY);
}

export function createWeatherService(
  transport: WeatherTransport = callCloudFunction,
  storage: StorageApi | null = getDefaultStorage(),
) {
  return {
    searchLocations(payload: SearchLocationsRequest): Promise<SearchLocationsResult> {
      return transport({ functionName: CLOUD_FUNCTIONS.WEATHER, action: "searchLocations", requestId: createRequestId(), payload, parseData: parseSearchLocationsResult, timeoutMs: 10_000 });
    },
    async getWeather(locationKey?: string): Promise<WeatherResult> {
      const payload: GetWeatherRequest = locationKey === undefined ? {} : { locationKey };
      const result = await transport({ functionName: CLOUD_FUNCTIONS.WEATHER, action: "getWeather", requestId: createRequestId(), payload, parseData: parseWeatherResult, timeoutMs: 12_000 });
      saveWeatherSnapshot(result, storage);
      return result;
    },
  };
}

export const weatherService = createWeatherService();

import type { DefaultLocation } from "../../../../shared/types/user";
import type {
  SearchLocationsRequest,
  SearchLocationsResult,
  WeatherCacheStatus,
  WeatherLocation,
  WeatherResult,
} from "../../../../shared/types/weather";
import {
  CURRENT_FRESH_MS,
  CURRENT_STALE_MS,
  DAILY_FRESH_MS,
  DAILY_STALE_MS,
  createWeatherCacheId,
  createWeatherCacheKey,
} from "../domain/cache";
import type {
  CurrentWeatherCacheData,
  DailyWeatherCacheData,
  WeatherCacheRecord,
  WeatherProvider,
  WeatherSettingsRecord,
  WeatherStore,
} from "../domain/types";
import { WeatherError } from "../domain/types";

const LOCATION_KEY_PATTERN = /^open-meteo:(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/u;

function toDate(value: Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function validateLocationKey(value: string): string {
  const normalized = value.trim();
  const match = LOCATION_KEY_PATTERN.exec(normalized);
  const latitude = Number(match?.[1]);
  const longitude = Number(match?.[2]);
  if (
    match === null ||
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new WeatherError("INVALID_ARGUMENT", "城市标识无效");
  }
  return normalized;
}

function validateLocation(location: WeatherLocation): WeatherLocation {
  validateLocationKey(location.locationKey);
  if (
    location.displayName.trim().length === 0 ||
    location.displayName.length > 100 ||
    (location.adminArea !== null && location.adminArea.length > 100) ||
    location.countryCode.length < 2 ||
    location.countryCode.length > 3
  ) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气位置数据无效");
  }
  return location;
}

export async function resolveWeatherUser(
  openId: string | undefined,
  store: WeatherStore,
): Promise<{ ownerId: string; settings: WeatherSettingsRecord }> {
  if (!openId?.trim()) {
    throw new WeatherError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
  }
  const user = await store.findUserByOpenId(openId);
  if (user === null) {
    throw new WeatherError("USER_NOT_INITIALIZED", "请先完成用户初始化");
  }
  if (user.status !== "active") {
    throw new WeatherError("USER_DISABLED", "当前用户不可用");
  }
  const settings = await store.getSettingsByOwner(user._id);
  if (settings === null || settings.ownerId !== user._id) {
    throw new WeatherError("USER_NOT_INITIALIZED", "用户设置尚未初始化");
  }
  return { ownerId: user._id, settings };
}

export async function searchLocations(options: {
  payload: SearchLocationsRequest;
  provider: WeatherProvider;
}): Promise<SearchLocationsResult> {
  let items: WeatherLocation[];
  if (options.payload.mode === "keyword") {
    const keyword = options.payload.keyword.trim();
    if (keyword.length < 1 || keyword.length > 40) {
      throw new WeatherError("INVALID_ARGUMENT", "城市关键词长度应为 1 至 40 个字符");
    }
    items = await options.provider.searchLocations({ keyword });
  } else {
    const { latitude, longitude } = options.payload;
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      throw new WeatherError("INVALID_ARGUMENT", "定位坐标超出有效范围");
    }
    items = await options.provider.searchLocations({
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
    });
  }
  return { items: items.slice(0, 10).map(validateLocation) };
}

function isFresh(record: WeatherCacheRecord | null, now: Date): boolean {
  return record !== null && toDate(record.expiresAt).getTime() > now.getTime();
}

function isUsableStale(record: WeatherCacheRecord | null, now: Date): boolean {
  return record !== null && toDate(record.staleUntil).getTime() > now.getTime();
}

function buildCacheRecord(options: {
  provider: string;
  locationKey: string;
  displayName: string;
  dataType: "current" | "daily";
  normalizedData: CurrentWeatherCacheData | DailyWeatherCacheData;
  observedAt: Date;
  now: Date;
}): WeatherCacheRecord {
  const freshMs = options.dataType === "current" ? CURRENT_FRESH_MS : DAILY_FRESH_MS;
  const staleMs = options.dataType === "current" ? CURRENT_STALE_MS : DAILY_STALE_MS;
  const cacheKey = createWeatherCacheKey(options.provider, options.locationKey, options.dataType);
  return {
    _id: createWeatherCacheId(cacheKey),
    cacheKey,
    provider: options.provider,
    locationKey: options.locationKey,
    displayName: options.displayName,
    dataType: options.dataType,
    normalizedData: options.normalizedData,
    schemaVersion: 1,
    observedAt: options.observedAt,
    fetchedAt: options.now,
    expiresAt: new Date(options.now.getTime() + freshMs),
    staleUntil: new Date(options.now.getTime() + staleMs),
    updatedAt: options.now,
  };
}

function readCurrent(record: WeatherCacheRecord): CurrentWeatherCacheData {
  const value = record.normalizedData as CurrentWeatherCacheData;
  if (!value.location || !value.current) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气缓存格式无效");
  }
  return value;
}

function readDaily(record: WeatherCacheRecord): DailyWeatherCacheData {
  const value = record.normalizedData as DailyWeatherCacheData;
  if (!Array.isArray(value.daily)) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气缓存格式无效");
  }
  return value;
}

export async function getWeatherForSettings(options: {
  locationKey?: string;
  settings: Pick<WeatherSettingsRecord, "defaultLocation">;
  now: Date;
  store: WeatherStore;
  provider: WeatherProvider;
}): Promise<WeatherResult> {
  const selected: DefaultLocation | null = options.settings.defaultLocation;
  if (!options.locationKey && selected === null) {
    throw new WeatherError("WEATHER_LOCATION_REQUIRED", "请先选择城市");
  }
  const locationKey = validateLocationKey(options.locationKey ?? selected?.locationKey ?? "");
  const currentKey = createWeatherCacheKey(options.provider.name, locationKey, "current");
  const dailyKey = createWeatherCacheKey(options.provider.name, locationKey, "daily");
  let [currentCache, dailyCache] = await Promise.all([
    options.store.getCache(currentKey),
    options.store.getCache(dailyKey),
  ]);
  const currentWasFresh = isFresh(currentCache, options.now);
  const dailyWasFresh = isFresh(dailyCache, options.now);
  let usedStale = false;

  if (!currentWasFresh) {
    try {
      const displayName = selected?.locationKey === locationKey ? selected.displayName : undefined;
      const current = await options.provider.getCurrent(locationKey, displayName);
      validateLocation(current.location);
      currentCache = buildCacheRecord({
        provider: options.provider.name,
        locationKey,
        displayName: current.location.displayName,
        dataType: "current",
        normalizedData: { location: current.location, current: current.current },
        observedAt: current.observedAt,
        now: options.now,
      });
      await options.store.upsertCache(currentCache);
    } catch (error) {
      if (!isUsableStale(currentCache, options.now)) throw error;
      usedStale = true;
    }
  }

  if (!dailyWasFresh) {
    try {
      const daily = await options.provider.getDaily(locationKey);
      const displayName = currentCache === null ? selected?.displayName ?? locationKey : readCurrent(currentCache).location.displayName;
      dailyCache = buildCacheRecord({
        provider: options.provider.name,
        locationKey,
        displayName,
        dataType: "daily",
        normalizedData: { daily: daily.daily.slice(0, 3) },
        observedAt: daily.observedAt,
        now: options.now,
      });
      await options.store.upsertCache(dailyCache);
    } catch (error) {
      if (!isUsableStale(dailyCache, options.now)) throw error;
      usedStale = true;
    }
  }

  if (currentCache === null || dailyCache === null) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气服务暂时不可用");
  }
  const current = readCurrent(currentCache);
  const daily = readDaily(dailyCache);
  const status: WeatherCacheStatus = usedStale
    ? "stale"
    : currentWasFresh && dailyWasFresh
      ? "fresh"
      : "refreshed";
  const fetchedAt = new Date(Math.min(toDate(currentCache.fetchedAt).getTime(), toDate(dailyCache.fetchedAt).getTime()));
  return {
    location: current.location,
    current: current.current,
    daily: daily.daily.slice(0, 3),
    observedAt: toDate(currentCache.observedAt).toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    cacheStatus: status,
    provider: options.provider.name,
  };
}

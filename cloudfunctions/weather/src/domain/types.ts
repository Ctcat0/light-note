import type { ApiErrorCode } from "../../../../shared/types/api";
import type { DefaultLocation } from "../../../../shared/types/user";
import type {
  CurrentWeather,
  DailyWeather,
  WeatherLocation,
} from "../../../../shared/types/weather";

export type WeatherDataType = "current" | "daily";

export interface WeatherUserRecord {
  _id: string;
  openId: string;
  status: "active" | "disabled" | "deletion_pending" | "deleted";
}

export interface WeatherSettingsRecord {
  _id: string;
  ownerId: string;
  defaultLocation: DefaultLocation | null;
  showWeather: boolean;
}

export interface CurrentWeatherCacheData {
  location: WeatherLocation;
  current: CurrentWeather;
}

export interface DailyWeatherCacheData {
  daily: DailyWeather[];
}

export interface WeatherCacheRecord {
  _id: string;
  cacheKey: string;
  provider: string;
  locationKey: string;
  displayName: string;
  dataType: WeatherDataType;
  normalizedData: CurrentWeatherCacheData | DailyWeatherCacheData;
  schemaVersion: 1;
  observedAt: Date;
  fetchedAt: Date;
  expiresAt: Date;
  staleUntil: Date;
  updatedAt: Date;
}

export interface ProviderCurrentResult {
  location: WeatherLocation;
  current: CurrentWeather;
  observedAt: Date;
}

export interface ProviderDailyResult {
  daily: DailyWeather[];
  observedAt: Date;
}

export interface WeatherProvider {
  readonly name: string;
  searchLocations(input: {
    keyword?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<WeatherLocation[]>;
  getCurrent(locationKey: string, displayName?: string): Promise<ProviderCurrentResult>;
  getDaily(locationKey: string): Promise<ProviderDailyResult>;
}

export interface WeatherStore {
  findUserByOpenId(openId: string): Promise<WeatherUserRecord | null>;
  getSettingsByOwner(ownerId: string): Promise<WeatherSettingsRecord | null>;
  getCache(cacheKey: string): Promise<WeatherCacheRecord | null>;
  upsertCache(record: WeatherCacheRecord): Promise<void>;
}

export class WeatherError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "WeatherError";
    this.code = code;
  }
}

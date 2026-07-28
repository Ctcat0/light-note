import { createHash } from "node:crypto";
import type { WeatherDataType } from "./types";

export const CURRENT_FRESH_MS = 15 * 60 * 1000;
export const CURRENT_STALE_MS = 6 * 60 * 60 * 1000;
export const DAILY_FRESH_MS = 2 * 60 * 60 * 1000;
export const DAILY_STALE_MS = 24 * 60 * 60 * 1000;

export function createWeatherCacheKey(
  provider: string,
  locationKey: string,
  dataType: WeatherDataType,
): string {
  return `${provider}:${locationKey}:${dataType}`;
}

export function createWeatherCacheId(cacheKey: string): string {
  return `weather_${createHash("sha256").update(cacheKey).digest("hex").slice(0, 40)}`;
}

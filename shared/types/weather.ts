export type WeatherCacheStatus = "fresh" | "refreshed" | "stale";

export interface WeatherLocation {
  locationKey: string;
  displayName: string;
  adminArea: string | null;
  countryCode: string;
}

export interface CurrentWeather {
  temperatureCelsius: number;
  apparentTemperatureCelsius: number | null;
  conditionCode: string;
  conditionText: string;
  humidityPercent: number | null;
  windDirection: string | null;
  windScale: string | null;
  precipitationProbabilityPercent: number | null;
}

export interface DailyWeather {
  dateKey: string;
  minTemperatureCelsius: number;
  maxTemperatureCelsius: number;
  conditionCode: string;
  conditionText: string;
  precipitationProbabilityPercent: number | null;
}

export interface WeatherResult {
  location: WeatherLocation;
  current: CurrentWeather;
  daily: DailyWeather[];
  observedAt: string;
  fetchedAt: string;
  cacheStatus: WeatherCacheStatus;
  provider: string;
}

export type SearchLocationsRequest =
  | { mode: "keyword"; keyword: string }
  | { mode: "coordinates"; latitude: number; longitude: number };

export interface SearchLocationsResult {
  items: WeatherLocation[];
}

export interface GetWeatherRequest {
  locationKey?: string;
}

import { request as httpsRequest } from "node:https";
import type {
  CurrentWeather,
  DailyWeather,
  WeatherLocation,
} from "../../../../shared/types/weather";
import type { WeatherProvider } from "../domain/types";
import { WeatherError } from "../domain/types";

const FORECAST_HOST = "api.open-meteo.com";
const GEOCODING_HOST = "geocoding-api.open-meteo.com";
const LOCATION_KEY_PATTERN = /^open-meteo:(-?\d{1,2}(?:\.\d{1,4})?),(-?\d{1,3}(?:\.\d{1,4})?)$/u;

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type WeatherFetch = (
  input: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<FetchResponse>;

interface ForecastBundle {
  current: CurrentWeather;
  daily: DailyWeather[];
  observedAt: Date;
}

function nodeWeatherFetch(
  input: string,
  init: { headers: Record<string, string>; timeoutMs: number },
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(input, { method: "GET", headers: init.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const status = response.statusCode ?? 500;
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(body) as unknown,
        });
      });
    });
    request.setTimeout(init.timeoutMs, () => request.destroy(new Error("weather request timeout")));
    request.on("error", reject);
    request.end();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气供应商返回了无效数值");
  }
  return number;
}

function nullableNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  return finiteNumber(value, min, max);
}

function requiredText(value: unknown, label: string, maxLength = 100): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new WeatherError("WEATHER_UNAVAILABLE", `${label}数据无效`);
  }
  return value.trim();
}

function nullableText(value: unknown, maxLength = 100): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : null;
}

function coordinateText(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/u, "");
}

function createLocationKey(latitude: number, longitude: number): string {
  return `open-meteo:${coordinateText(latitude)},${coordinateText(longitude)}`;
}

function parseLocationCoordinates(locationKey: string): { latitude: number; longitude: number } {
  const match = LOCATION_KEY_PATTERN.exec(locationKey);
  if (match === null) throw new WeatherError("INVALID_ARGUMENT", "城市标识无效，请重新选择城市");
  const latitude = finiteNumber(match[1], -90, 90);
  const longitude = finiteNumber(match[2], -180, 180);
  return { latitude, longitude };
}

function countryCode(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z]{2}$/u.test(value) ? value.toUpperCase() : "--";
}

function parseSearchLocation(value: unknown): WeatherLocation {
  if (!isRecord(value)) throw new WeatherError("WEATHER_UNAVAILABLE", "城市数据无效");
  const name = requiredText(value.name, "城市名称");
  const latitude = finiteNumber(value.latitude, -90, 90);
  const longitude = finiteNumber(value.longitude, -180, 180);
  const admin1 = nullableText(value.admin1);
  const admin2 = nullableText(value.admin2);
  const country = nullableText(value.country);
  const parts = [name, admin2, admin1, country].filter(
    (part, index, values): part is string => part !== null && values.indexOf(part) === index,
  );
  return {
    locationKey: createLocationKey(latitude, longitude),
    displayName: parts.join(" · "),
    adminArea: admin1,
    countryCode: countryCode(value.country_code),
  };
}

function weatherText(code: number): string {
  if (code === 0) return "晴";
  if (code === 1) return "大部晴朗";
  if (code === 2) return "多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return code >= 66 ? "冻雨" : "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code === 85 || code === 86) return "阵雪";
  if (code === 95) return "雷暴";
  if (code === 96 || code === 99) return "雷暴伴冰雹";
  return "未知天气";
}

function windDirection(degrees: number | null): string | null {
  if (degrees === null) return null;
  const names = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return names[Math.round(degrees / 45) % names.length] ?? null;
}

function windScale(speedKmh: number | null): string | null {
  if (speedKmh === null) return null;
  const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const scale = thresholds.findIndex((threshold) => speedKmh < threshold);
  return `${scale === -1 ? 12 : scale}级`;
}

function arrayItem(value: unknown, index: number, label: string): unknown {
  if (!Array.isArray(value) || index >= value.length) {
    throw new WeatherError("WEATHER_UNAVAILABLE", `${label}数据无效`);
  }
  return value[index];
}

function parseObservedAt(value: unknown, utcOffsetSeconds: unknown): Date {
  const text = requiredText(value, "天气观测时间", 40);
  const offset = finiteNumber(utcOffsetSeconds, -86_400, 86_400);
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/u.test(text)
    ? Date.parse(text)
    : Date.parse(`${text}Z`) - offset * 1_000;
  if (!Number.isFinite(timestamp)) throw new WeatherError("WEATHER_UNAVAILABLE", "天气观测时间无效");
  return new Date(timestamp);
}

function parseForecast(value: unknown): ForecastBundle {
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.daily)) {
    throw new WeatherError("WEATHER_UNAVAILABLE", "天气预报数据无效");
  }
  const currentRaw = value.current;
  const dailyRaw = value.daily;
  const currentCode = Math.trunc(finiteNumber(currentRaw.weather_code, 0, 99));
  const current: CurrentWeather = {
    temperatureCelsius: finiteNumber(currentRaw.temperature_2m, -100, 70),
    apparentTemperatureCelsius: nullableNumber(currentRaw.apparent_temperature, -120, 80),
    conditionCode: String(currentCode),
    conditionText: weatherText(currentCode),
    humidityPercent: nullableNumber(currentRaw.relative_humidity_2m, 0, 100),
    windDirection: windDirection(nullableNumber(currentRaw.wind_direction_10m, 0, 360)),
    windScale: windScale(nullableNumber(currentRaw.wind_speed_10m, 0, 500)),
    precipitationProbabilityPercent: null,
  };
  const times = dailyRaw.time;
  if (!Array.isArray(times) || times.length === 0) throw new WeatherError("WEATHER_UNAVAILABLE", "天气预报日期无效");
  const daily: DailyWeather[] = times.slice(0, 3).map((date, index) => {
    const code = Math.trunc(finiteNumber(arrayItem(dailyRaw.weather_code, index, "天气代码"), 0, 99));
    return {
      dateKey: requiredText(date, "预报日期", 10),
      minTemperatureCelsius: finiteNumber(arrayItem(dailyRaw.temperature_2m_min, index, "最低温度"), -100, 70),
      maxTemperatureCelsius: finiteNumber(arrayItem(dailyRaw.temperature_2m_max, index, "最高温度"), -100, 70),
      conditionCode: String(code),
      conditionText: weatherText(code),
      precipitationProbabilityPercent: nullableNumber(
        arrayItem(dailyRaw.precipitation_probability_max, index, "降水概率"),
        0,
        100,
      ),
    };
  });
  return {
    current,
    daily,
    observedAt: parseObservedAt(currentRaw.time, value.utc_offset_seconds),
  };
}

export function createOpenMeteoProvider(options: {
  fetcher?: WeatherFetch | undefined;
  timeoutMs?: number | undefined;
} = {}): WeatherProvider {
  const fetcher = options.fetcher ?? nodeWeatherFetch;
  const timeoutMs = options.timeoutMs ?? 6_000;
  let memo: { locationKey: string; createdAt: number; promise: Promise<ForecastBundle> } | null = null;

  async function request(host: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const query = Object.entries(params).map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join("&");
    let response: FetchResponse;
    try {
      response = await fetcher(`https://${host}${path}?${query}`, {
        headers: { Accept: "application/json", "Accept-Encoding": "identity" },
        timeoutMs,
      });
    } catch {
      throw new WeatherError("WEATHER_UNAVAILABLE", "天气供应商请求失败");
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || body.error === true) {
      throw new WeatherError("WEATHER_UNAVAILABLE", "天气供应商暂时不可用");
    }
    return body;
  }

  function getForecast(locationKey: string): Promise<ForecastBundle> {
    const existing = memo;
    if (existing !== null && existing.locationKey === locationKey && Date.now() - existing.createdAt < 10_000) {
      return existing.promise;
    }
    const { latitude, longitude } = parseLocationCoordinates(locationKey);
    const promise = request(FORECAST_HOST, "/v1/forecast", {
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: "3",
      timezone: "auto",
    }).then(parseForecast);
    memo = { locationKey, createdAt: Date.now(), promise };
    return promise;
  }

  return {
    name: "open-meteo",
    async searchLocations(input) {
      if (input.latitude !== undefined && input.longitude !== undefined) {
        return [{
          locationKey: createLocationKey(input.latitude, input.longitude),
          displayName: "当前位置",
          adminArea: null,
          countryCode: "--",
        }];
      }
      const body = await request(GEOCODING_HOST, "/v1/search", {
        name: input.keyword ?? "",
        count: "10",
        language: "zh",
        format: "json",
      });
      return Array.isArray(body.results) ? body.results.map(parseSearchLocation) : [];
    },
    async getCurrent(locationKey, displayName) {
      const forecast = await getForecast(locationKey);
      return {
        location: {
          locationKey,
          displayName: displayName?.trim() || "所选位置",
          adminArea: null,
          countryCode: "--",
        },
        current: forecast.current,
        observedAt: forecast.observedAt,
      };
    },
    async getDaily(locationKey) {
      const forecast = await getForecast(locationKey);
      return { daily: forecast.daily, observedAt: forecast.observedAt };
    },
  };
}

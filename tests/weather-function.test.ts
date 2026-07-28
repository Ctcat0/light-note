import assert from "node:assert/strict";
import test from "node:test";
import { getWeatherForSettings, searchLocations } from "../cloudfunctions/weather/src/application/weather";
import type { WeatherCacheRecord, WeatherProvider, WeatherSettingsRecord, WeatherStore, WeatherUserRecord } from "../cloudfunctions/weather/src/domain/types";
import { WeatherError } from "../cloudfunctions/weather/src/domain/types";
import type { WeatherLocation } from "../shared/types/weather";

const LOCATION: WeatherLocation = { locationKey: "open-meteo:39.9042,116.4074", displayName: "北京 · 北京市", adminArea: "北京市", countryCode: "CN" };
const SETTINGS: WeatherSettingsRecord = { _id: "settings", ownerId: "user-1", defaultLocation: { locationKey: LOCATION.locationKey, displayName: LOCATION.displayName, source: "manual" }, showWeather: true };

class MemoryWeatherStore implements WeatherStore {
  caches = new Map<string, WeatherCacheRecord>();
  user: WeatherUserRecord = { _id: "user-1", openId: "openid", status: "active" };
  findUserByOpenId = async (): Promise<WeatherUserRecord | null> => this.user;
  getSettingsByOwner = async (): Promise<WeatherSettingsRecord | null> => SETTINGS;
  getCache = async (key: string): Promise<WeatherCacheRecord | null> => this.caches.get(key) ?? null;
  upsertCache = async (record: WeatherCacheRecord): Promise<void> => { this.caches.set(record.cacheKey, record); };
}

interface ProviderState { calls: number; fail?: boolean; coordinates?: [number, number] }

function provider(state: ProviderState): WeatherProvider {
  return {
    name: "open-meteo",
    async searchLocations(input) {
      if (input.latitude !== undefined && input.longitude !== undefined) state.coordinates = [input.latitude, input.longitude];
      return [LOCATION];
    },
    async getCurrent() {
      state.calls += 1;
      if (state.fail) throw new WeatherError("WEATHER_UNAVAILABLE", "provider failed");
      return { location: LOCATION, current: { temperatureCelsius: 28, apparentTemperatureCelsius: 29, conditionCode: "101", conditionText: "多云", humidityPercent: 60, windDirection: "东风", windScale: "2", precipitationProbabilityPercent: null }, observedAt: new Date("2026-07-22T04:00:00.000Z") };
    },
    async getDaily() {
      state.calls += 1;
      if (state.fail) throw new WeatherError("WEATHER_UNAVAILABLE", "provider failed");
      return { daily: [{ dateKey: "2026-07-22", minTemperatureCelsius: 22, maxTemperatureCelsius: 31, conditionCode: "101", conditionText: "多云", precipitationProbabilityPercent: null }], observedAt: new Date("2026-07-22T04:00:00.000Z") };
    },
  };
}

test("天气首次刷新写入双缓存，高频请求命中新鲜缓存", async () => {
  const store = new MemoryWeatherStore();
  const state: ProviderState = { calls: 0 };
  const adapter = provider(state);
  const now = new Date("2026-07-22T04:05:00.000Z");
  const first = await getWeatherForSettings({ settings: SETTINGS, now, store, provider: adapter });
  const second = await getWeatherForSettings({ settings: SETTINGS, now: new Date(now.getTime() + 60_000), store, provider: adapter });
  assert.equal(first.cacheStatus, "refreshed");
  assert.equal(second.cacheStatus, "fresh");
  assert.equal(state.calls, 2);
  assert.equal(store.caches.size, 2);
});

test("供应商失败时在窗口内返回 stale，窗口外明确失败", async () => {
  const store = new MemoryWeatherStore();
  const state: ProviderState = { calls: 0 };
  const adapter = provider(state);
  const now = new Date("2026-07-22T04:05:00.000Z");
  await getWeatherForSettings({ settings: SETTINGS, now, store, provider: adapter });
  state.fail = true;
  const stale = await getWeatherForSettings({ settings: SETTINGS, now: new Date(now.getTime() + 20 * 60_000), store, provider: adapter });
  assert.equal(stale.cacheStatus, "stale");
  await assert.rejects(
    () => getWeatherForSettings({ settings: SETTINGS, now: new Date(now.getTime() + 7 * 60 * 60_000), store, provider: adapter }),
    (error: unknown) => error instanceof WeatherError && error.code === "WEATHER_UNAVAILABLE",
  );
});

test("城市搜索拒绝超长关键词和非法坐标，并只传两位精度坐标", async () => {
  const state: ProviderState = { calls: 0 };
  const adapter = provider(state);
  await assert.rejects(() => searchLocations({ payload: { mode: "keyword", keyword: "x".repeat(41) }, provider: adapter }), /1 至 40/u);
  await assert.rejects(() => searchLocations({ payload: { mode: "coordinates", latitude: 91, longitude: 0 }, provider: adapter }), /有效范围/u);
  await searchLocations({ payload: { mode: "coordinates", latitude: 39.91666, longitude: 116.41666 }, provider: adapter });
  assert.deepEqual(state.coordinates, [39.92, 116.42]);
});

test("没有默认城市时返回 WEATHER_LOCATION_REQUIRED", async () => {
  const store = new MemoryWeatherStore();
  const settings = { ...SETTINGS, defaultLocation: null };
  await assert.rejects(
    () => getWeatherForSettings({ settings, now: new Date(), store, provider: provider({ calls: 0 }) }),
    (error: unknown) => error instanceof WeatherError && error.code === "WEATHER_LOCATION_REQUIRED",
  );
});

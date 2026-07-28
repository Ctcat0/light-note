import assert from "node:assert/strict";
import test from "node:test";
import type { CloudCallOptions } from "../miniprogram/services/cloud";
import {
  clearWeatherLocalCache,
  createWeatherService,
} from "../miniprogram/services/weather";

test("weather service 只向受控云函数发送标准城市查询", async () => {
  const captured: { value: CloudCallOptions<object, unknown> | null } = { value: null };
  const service = createWeatherService(async (options) => {
    captured.value = options as CloudCallOptions<object, unknown>;
    return options.parseData({ items: [{ locationKey: "open-meteo:39.9042,116.4074", displayName: "北京", adminArea: "北京市", countryCode: "CN" }] });
  });
  const result = await service.searchLocations({ mode: "keyword", keyword: "北京" });
  assert.equal(captured.value?.functionName, "weather");
  assert.equal(captured.value?.action, "searchLocations");
  assert.equal(JSON.stringify(captured.value).includes("http"), false);
  assert.equal(result.items[0]?.locationKey, "open-meteo:39.9042,116.4074");
});

test("weather service 解析稳定 DTO 和 stale 标记", async () => {
  const service = createWeatherService(async (options) => options.parseData({
    location: { locationKey: "open-meteo:39.9042,116.4074", displayName: "北京", adminArea: "北京市", countryCode: "CN" },
    current: { temperatureCelsius: 30, apparentTemperatureCelsius: 31, conditionCode: "100", conditionText: "晴", humidityPercent: 50, windDirection: "南风", windScale: "2", precipitationProbabilityPercent: null },
    daily: [{ dateKey: "2026-07-22", minTemperatureCelsius: 22, maxTemperatureCelsius: 32, conditionCode: "100", conditionText: "晴", precipitationProbabilityPercent: null }],
    observedAt: "2026-07-22T04:00:00.000Z",
    fetchedAt: "2026-07-22T04:05:00.000Z",
    cacheStatus: "stale",
    provider: "open-meteo",
  }));
  const result = await service.getWeather();
  assert.equal(result.cacheStatus, "stale");
  assert.equal(result.current.temperatureCelsius, 30);
});

test("weather service 写入的本地快照可以显式清除", async () => {
  const values = new Map<string, unknown>();
  const storage = {
    setStorageSync(key: string, value: unknown): void {
      values.set(key, value);
    },
    removeStorageSync(key: string): void {
      values.delete(key);
    },
  };
  const service = createWeatherService(
    async (options) =>
      options.parseData({
        location: {
          locationKey: "open-meteo:39.9042,116.4074",
          displayName: "北京",
          adminArea: "北京市",
          countryCode: "CN",
        },
        current: {
          temperatureCelsius: 30,
          apparentTemperatureCelsius: 31,
          conditionCode: "100",
          conditionText: "晴",
          humidityPercent: 50,
          windDirection: "南风",
          windScale: "2",
          precipitationProbabilityPercent: null,
        },
        daily: [],
        observedAt: "2026-07-22T04:00:00.000Z",
        fetchedAt: "2026-07-22T04:05:00.000Z",
        cacheStatus: "fresh",
        provider: "open-meteo",
      }),
    storage,
  );
  await service.getWeather();
  assert.equal(values.size, 1);
  clearWeatherLocalCache(storage);
  assert.equal(values.size, 0);
});

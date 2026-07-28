import assert from "node:assert/strict";
import test from "node:test";
import { getHomeOverview } from "../cloudfunctions/home/src/application/overview";
import type { HomeSettingsRecord, HomeStore } from "../cloudfunctions/home/src/domain/types";
import type { WeatherProvider, WeatherStore } from "../cloudfunctions/weather/src/domain/types";
import { WeatherError } from "../cloudfunctions/weather/src/domain/types";
import { clearHomeSnapshot, saveHomeSnapshot } from "../miniprogram/services/home";
import type { HomeOverviewResult } from "../shared/types/home";

const settings: HomeSettingsRecord = { _id: "settings", ownerId: "user-1", timezone: "Asia/Shanghai", defaultLocation: null, showWeather: true };

function homeStore(failLedger = false): HomeStore {
  return {
    findUserByOpenId: async () => ({ _id: "user-1", openId: "openid", status: "active" }),
    getSettingsByOwner: async () => settings,
    sumTransactions: async ({ type, startAt, endAt }) => {
      if (failLedger) throw new Error("database failed");
      const isDay = endAt.getTime() - startAt.getTime() <= 25 * 60 * 60 * 1000;
      return type === "income" ? (isDay ? 1000 : 5000) : (isDay ? 300 : 2000);
    },
    getTodoOverview: async () => ({ todayTotal: 3, todayCompleted: 1, overdueCount: 1, items: [] }),
  };
}

const weatherStore: WeatherStore = {
  findUserByOpenId: async () => null,
  getSettingsByOwner: async () => null,
  getCache: async () => null,
  upsertCache: async () => undefined,
};
const failingProvider: WeatherProvider = {
  name: "open-meteo",
  searchLocations: async () => [],
  getCurrent: async () => { throw new WeatherError("WEATHER_UNAVAILABLE", "weather failed"); },
  getDaily: async () => { throw new WeatherError("WEATHER_UNAVAILABLE", "weather failed"); },
};

test("首页天气失败不阻断收支和待办模块", async () => {
  const result = await getHomeOverview({ ownerId: "user-1", settings, now: new Date("2026-07-22T04:00:00.000Z"), store: homeStore(), weatherStore, provider: failingProvider });
  assert.equal(result.dateKey, "2026-07-22");
  assert.equal(result.weather.status, "unavailable");
  assert.equal(result.ledger.status, "success");
  assert.equal(result.todos.status, "success");
  if (result.ledger.status === "success") assert.equal(result.ledger.data.monthBalanceInCents, 3000);
  if (result.todos.status === "success") assert.equal(result.todos.data.todayPending, 2);
});

test("收支失败时待办仍成功并返回模块级错误", async () => {
  const result = await getHomeOverview({ ownerId: "user-1", settings, now: new Date("2026-07-22T04:00:00.000Z"), store: homeStore(true), weatherStore, provider: failingProvider });
  assert.equal(result.ledger.status, "unavailable");
  assert.equal(result.todos.status, "success");
  if (result.ledger.status === "unavailable") assert.equal(result.ledger.code, "TRANSACTION_SUMMARY_FAILED");
});

test("首页拒绝查询非今天日期", async () => {
  await assert.rejects(
    () => getHomeOverview({ ownerId: "user-1", settings, requestedDateKey: "2026-07-21", now: new Date("2026-07-22T04:00:00.000Z"), store: homeStore(), weatherStore, provider: failingProvider }),
    /INVALID_DATE/u,
  );
});

test("首页本地快照属于可再生缓存并可显式清除", () => {
  const values = new Map<string, unknown>();
  const storage = {
    getStorageSync(key: string): unknown {
      return values.get(key);
    },
    setStorageSync(key: string, value: unknown): void {
      values.set(key, value);
    },
    removeStorageSync(key: string): void {
      values.delete(key);
    },
  };
  const overview = {
    dateKey: "2026-07-22",
    timezone: "Asia/Shanghai",
    ledger: { status: "unavailable", data: null, code: "TEST", message: "test" },
    todos: { status: "unavailable", data: null, code: "TEST", message: "test" },
    weather: { status: "unavailable", data: null, code: "TEST", message: "test" },
    generatedAt: "2026-07-22T04:00:00.000Z",
  } satisfies HomeOverviewResult;
  saveHomeSnapshot(overview, storage);
  assert.equal(values.size, 1);
  clearHomeSnapshot(storage);
  assert.equal(values.size, 0);
});

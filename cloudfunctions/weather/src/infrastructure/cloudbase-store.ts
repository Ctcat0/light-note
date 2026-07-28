import type {
  WeatherCacheRecord,
  WeatherSettingsRecord,
  WeatherStore,
  WeatherUserRecord,
} from "../domain/types";

interface QueryResult { data: unknown[] }
interface DocumentResult { data: unknown }
interface CloudQuery {
  where(query: Record<string, unknown>): CloudQuery;
  limit(limit: number): CloudQuery;
  get(): Promise<QueryResult>;
}
interface CloudDocument {
  get(): Promise<DocumentResult>;
  set(options: { data: Record<string, unknown> }): Promise<unknown>;
}
interface CloudCollection extends CloudQuery { doc(id: string): CloudDocument }
export interface CloudDatabase { collection(name: string): CloudCollection }

function withoutId(record: WeatherCacheRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "_id"));
}

export function createCloudBaseWeatherStore(database: CloudDatabase): WeatherStore {
  return {
    async findUserByOpenId(openId) {
      const result = await database.collection("users").where({ openId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as WeatherUserRecord;
    },
    async getSettingsByOwner(ownerId) {
      const result = await database.collection("user_settings").where({ ownerId }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as WeatherSettingsRecord;
    },
    async getCache(cacheKey) {
      const result = await database.collection("weather_cache").where({ cacheKey }).limit(1).get();
      return result.data[0] === undefined ? null : result.data[0] as WeatherCacheRecord;
    },
    async upsertCache(record) {
      await database.collection("weather_cache").doc(record._id).set({ data: withoutId(record) });
    },
  };
}

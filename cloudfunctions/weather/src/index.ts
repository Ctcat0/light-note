import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type { SearchLocationsResult, WeatherResult } from "../../../shared/types/weather";
import { createWeatherFunctionHandler } from "./application/handler";
import { createCloudBaseWeatherStore, type CloudDatabase } from "./infrastructure/cloudbase-store";
import { createOpenMeteoProvider } from "./infrastructure/open-meteo-provider";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });
const database = cloud.database() as unknown as CloudDatabase;
const handler = createWeatherFunctionHandler({
  getOpenId(): string | undefined {
    const value = (cloud.getWXContext() as unknown as Record<string, unknown>).OPENID;
    return typeof value === "string" ? value : undefined;
  },
  getCurrentTime: () => new Date(),
  store: createCloudBaseWeatherStore(database),
  provider: createOpenMeteoProvider(),
});

export async function main(event: unknown): Promise<ApiResponse<SearchLocationsResult | WeatherResult>> {
  return handler(event);
}

import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type { HomeOverviewResult } from "../../../shared/types/home";
import { createCloudBaseWeatherStore, type CloudDatabase as WeatherCloudDatabase } from "../../weather/src/infrastructure/cloudbase-store";
import { createOpenMeteoProvider } from "../../weather/src/infrastructure/open-meteo-provider";
import { createHomeFunctionHandler } from "./application/handler";
import { createCloudBaseHomeStore, type CloudDatabase } from "./infrastructure/cloudbase-store";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });
const database = cloud.database() as unknown as CloudDatabase;
const openId = (): string | undefined => {
  const value = (cloud.getWXContext() as unknown as Record<string, unknown>).OPENID;
  return typeof value === "string" ? value : undefined;
};
const handler = createHomeFunctionHandler({
  getOpenId: openId,
  getCurrentTime: () => new Date(),
  store: createCloudBaseHomeStore(database),
  weatherStore: createCloudBaseWeatherStore(database as unknown as WeatherCloudDatabase),
  provider: createOpenMeteoProvider(),
});

export async function main(event: unknown): Promise<ApiResponse<HomeOverviewResult>> {
  return handler(event);
}

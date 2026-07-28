import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type { UserInitializationResult, UserSettings } from "../../../shared/types/user";
import { createUserFunctionHandler } from "./application/handler";
import {
  createCloudBaseUserInitializationStore,
  type CloudDatabase,
} from "./infrastructure/cloudbase-store";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

const database = cloud.database() as unknown as CloudDatabase;
const store = createCloudBaseUserInitializationStore(database);

const handler = createUserFunctionHandler({
  getOpenId(): string | undefined {
    const context = cloud.getWXContext() as unknown as Record<string, unknown>;
    const openId = context.OPENID;

    return typeof openId === "string" ? openId : undefined;
  },
  getCurrentTime: () => new Date(),
  store,
});

export async function main(
  event: unknown,
): Promise<ApiResponse<UserInitializationResult | UserSettings>> {
  return handler(event);
}

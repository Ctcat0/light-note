import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type {
  CancelDataDeletionResult,
  GetDataDeletionStatusResult,
  RequestDataDeletionResult,
} from "../../../shared/types/data-deletion";
import { createDataDeletionHandler } from "./application/handler";
import {
  createCloudBaseDataDeletionStore,
  type CloudDatabase,
} from "./infrastructure/cloudbase-store";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

const store = createCloudBaseDataDeletionStore(
  cloud.database() as unknown as CloudDatabase,
);
const handler = createDataDeletionHandler({
  getOpenId(): string | undefined {
    const context = cloud.getWXContext() as unknown as Record<string, unknown>;
    return typeof context.OPENID === "string" ? context.OPENID : undefined;
  },
  getCurrentTime: () => new Date(),
  store,
});

export function main(
  event: unknown,
): Promise<
  ApiResponse<
    | GetDataDeletionStatusResult
    | RequestDataDeletionResult
    | CancelDataDeletionResult
  >
> {
  return handler(event);
}

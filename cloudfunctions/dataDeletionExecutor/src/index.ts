import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import {
  createDataDeletionExecutor,
  type ExecutorResult,
} from "./application/executor";
import {
  createCloudBaseDataDeletionExecutorStore,
  type CloudDatabase,
} from "./infrastructure/cloudbase-store";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });

const handler = createDataDeletionExecutor({
  expectedToken: process.env.DATA_DELETION_EXECUTOR_TOKEN,
  getCurrentTime: () => new Date(),
  store: createCloudBaseDataDeletionExecutorStore(
    cloud.database() as unknown as CloudDatabase,
  ),
});

export function main(event: unknown): Promise<ApiResponse<ExecutorResult>> {
  return handler(event);
}

import * as cloud from "wx-server-sdk";
import type { ApiResponse } from "../../../shared/types/api";
import type { Todo } from "../../../shared/types/todo";
import { createTodoFunctionHandler } from "./application/handler";
import { createCloudBaseTodoStore, type CloudDatabase } from "./infrastructure/cloudbase-store";

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV as unknown as string });
const database = cloud.database() as unknown as CloudDatabase;
const handler = createTodoFunctionHandler({
  getOpenId(): string | undefined {
    const value = (cloud.getWXContext() as unknown as Record<string, unknown>).OPENID;
    return typeof value === "string" ? value : undefined;
  },
  getCurrentTime: () => new Date(),
  store: createCloudBaseTodoStore(database),
});

export async function main(event: unknown): Promise<ApiResponse<Todo | object>> {
  return handler(event);
}

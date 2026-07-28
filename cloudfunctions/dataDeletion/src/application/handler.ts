import type { ApiErrorCode, ApiResponse } from "../../../../shared/types/api";
import type {
  CancelDataDeletionResult,
  GetDataDeletionStatusResult,
  RequestDataDeletionResult,
} from "../../../../shared/types/data-deletion";
import type { DataDeletionStore } from "../domain/types";
import { DataDeletionError } from "../domain/types";
import {
  cancelDeletion,
  getDeletionStatus,
  requestDeletion,
} from "./requests";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ResponseData =
  | GetDataDeletionStatusResult
  | RequestDataDeletionResult
  | CancelDataDeletionResult;

interface Dependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: DataDeletionStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    keys.every((key) => allowed.includes(key))
  );
}

function failure(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  now: Date,
): ApiResponse<ResponseData> {
  return {
    success: false,
    code,
    message,
    data: null,
    requestId,
    serverTime: now.toISOString(),
  };
}

export function createDataDeletionHandler(
  dependencies: Dependencies,
): (event: unknown) => Promise<ApiResponse<ResponseData>> {
  return async (event) => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId =
      isRecord(event) && typeof event.requestId === "string"
        ? event.requestId.slice(0, 128)
        : `server-${now.getTime().toString(36)}`;
    try {
      if (
        !isRecord(event) ||
        typeof event.action !== "string" ||
        typeof event.requestId !== "string" ||
        !UUID_PATTERN.test(event.requestId) ||
        !isRecord(event.payload)
      ) {
        throw new DataDeletionError("INVALID_ARGUMENT", "请求格式无效");
      }
      if (
        ["ownerId", "userId", "openId", "openid", "OPENID"].some((key) =>
          Object.prototype.hasOwnProperty.call(event, key),
        )
      ) {
        throw new DataDeletionError(
          "INVALID_ARGUMENT",
          "请求包含不可信身份字段",
        );
      }
      let data: ResponseData;
      if (event.action === "getStatus") {
        if (!exact(event.payload, [], [])) {
          throw new DataDeletionError(
            "INVALID_ARGUMENT",
            "删除状态查询不接受业务参数",
          );
        }
        data = await getDeletionStatus({
          openId: dependencies.getOpenId(),
          store: dependencies.store,
        });
      } else if (event.action === "request") {
        if (!exact(event.payload, [], [])) {
          throw new DataDeletionError(
            "INVALID_ARGUMENT",
            "删除申请不接受业务参数",
          );
        }
        data = await requestDeletion({
          openId: dependencies.getOpenId(),
          requestId: event.requestId,
          now,
          store: dependencies.store,
        });
      } else if (event.action === "cancel") {
        if (
          !exact(event.payload, ["expectedVersion"], ["expectedVersion"]) ||
          !Number.isSafeInteger(event.payload.expectedVersion) ||
          Number(event.payload.expectedVersion) < 1
        ) {
          throw new DataDeletionError(
            "INVALID_ARGUMENT",
            "撤销删除申请参数无效",
          );
        }
        data = await cancelDeletion({
          openId: dependencies.getOpenId(),
          expectedVersion: Number(event.payload.expectedVersion),
          now,
          store: dependencies.store,
        });
      } else {
        throw new DataDeletionError("INVALID_ARGUMENT", "未知的删除申请操作");
      }
      return {
        success: true,
        code: "OK",
        message: "操作成功",
        data,
        requestId: event.requestId,
        serverTime: now.toISOString(),
      };
    } catch (error) {
      if (error instanceof DataDeletionError) {
        return failure(
          error.code,
          error.message,
          fallbackRequestId,
          now,
        );
      }
      return failure(
        "DEPENDENCY_ERROR",
        "个人数据删除服务暂时不可用，请稍后重试",
        fallbackRequestId,
        now,
      );
    }
  };
}

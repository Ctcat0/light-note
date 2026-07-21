import type {
  ApiErrorCode,
  ApiResponse,
  CloudFunctionRequest,
} from "../../../../shared/types/api";
import type {
  UserInitializationResult,
  UserInitPayload,
} from "../../../../shared/types/user";
import { initializeUser } from "./initialize-user";
import type { UserInitializationStore } from "../domain/types";
import { UserInitializationError } from "../domain/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserFunctionDependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: UserInitializationStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFallbackRequestId(): string {
  return `server-${Date.now().toString(36)}`;
}

function extractRequestId(event: unknown): string {
  if (
    isRecord(event) &&
    typeof event.requestId === "string" &&
    event.requestId.length <= 128
  ) {
    return event.requestId;
  }

  return createFallbackRequestId();
}

function parseInitRequest(
  event: unknown,
): CloudFunctionRequest<UserInitPayload> {
  if (!isRecord(event)) {
    throw new UserInitializationError("INVALID_ARGUMENT", "请求格式无效");
  }

  const keys = Object.keys(event);
  const requiredKeys = ["action", "payload", "requestId"];
  const prohibitedIdentityKeys = new Set([
    "userId",
    "openId",
    "openid",
    "OPENID",
  ]);

  if (
    requiredKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(event, key),
    ) ||
    keys.some((key) => prohibitedIdentityKeys.has(key))
  ) {
    throw new UserInitializationError(
      "INVALID_ARGUMENT",
      "请求包含未允许的字段",
    );
  }

  // CloudBase may inject runtime metadata such as userInfo. Ignore all
  // non-business fields; identity is read only from getWXContext().

  if (event.action !== "init") {
    throw new UserInitializationError("INVALID_ARGUMENT", "未知的用户操作");
  }

  if (
    typeof event.requestId !== "string" ||
    !UUID_PATTERN.test(event.requestId)
  ) {
    throw new UserInitializationError(
      "INVALID_ARGUMENT",
      "requestId 必须是 UUID",
    );
  }

  if (!isRecord(event.payload) || Object.keys(event.payload).length !== 0) {
    throw new UserInitializationError(
      "INVALID_ARGUMENT",
      "用户初始化不接受业务参数",
    );
  }

  return {
    action: event.action,
    requestId: event.requestId,
    payload: {},
  };
}

function successResponse(
  data: UserInitializationResult,
  requestId: string,
  now: Date,
): ApiResponse<UserInitializationResult> {
  return {
    success: true,
    code: "OK",
    message: "用户初始化成功",
    data,
    requestId,
    serverTime: now.toISOString(),
  };
}

function failureResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  now: Date,
): ApiResponse<UserInitializationResult> {
  return {
    success: false,
    code,
    message,
    data: null,
    requestId,
    serverTime: now.toISOString(),
  };
}

export function createUserFunctionHandler(
  dependencies: UserFunctionDependencies,
): (event: unknown) => Promise<ApiResponse<UserInitializationResult>> {
  return async (event: unknown): Promise<ApiResponse<UserInitializationResult>> => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId = extractRequestId(event);

    try {
      const request = parseInitRequest(event);
      const openId = dependencies.getOpenId();

      if (openId === undefined || openId.trim().length === 0) {
        throw new UserInitializationError(
          "UNAUTHENTICATED",
          "无法获取有效的微信用户身份",
        );
      }

      const result = await initializeUser({
        openId,
        now,
        store: dependencies.store,
      });

      return successResponse(result, request.requestId, now);
    } catch (error) {
      if (error instanceof UserInitializationError) {
        return failureResponse(
          error.code,
          error.message,
          fallbackRequestId,
          now,
        );
      }

      return failureResponse(
        "DEPENDENCY_ERROR",
        "用户初始化暂时不可用，请稍后重试",
        fallbackRequestId,
        now,
      );
    }
  };
}

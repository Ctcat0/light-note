import type { ApiErrorCode, ApiResponse } from "../../../../shared/types/api";
import type {
  DefaultLocation,
  UpdateUserSettingsPayload,
  UserInitializationResult,
  UserSettings,
} from "../../../../shared/types/user";
import type { UserInitializationStore } from "../domain/types";
import { UserInitializationError } from "../domain/types";
import { initializeUser } from "./initialize-user";
import { getUserSettings, updateUserSettings } from "./manage-settings";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type UserResponseData = UserInitializationResult | UserSettings;

interface UserFunctionDependencies {
  getOpenId(): string | undefined;
  getCurrentTime(): Date;
  store: UserInitializationStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && keys.every((key) => allowed.includes(key));
}

function extractRequestId(event: unknown): string {
  return isRecord(event) && typeof event.requestId === "string" ? event.requestId.slice(0, 128) : `server-${Date.now().toString(36)}`;
}

function parseLocation(value: unknown): DefaultLocation | null {
  if (value === null) return null;
  if (!isRecord(value) || !exact(value, ["locationKey", "displayName", "source"], ["locationKey", "displayName", "source"]) || typeof value.locationKey !== "string" || typeof value.displayName !== "string" || (value.source !== "manual" && value.source !== "geolocation")) {
    throw new UserInitializationError("INVALID_ARGUMENT", "默认城市参数无效");
  }
  return { locationKey: value.locationKey, displayName: value.displayName, source: value.source };
}

function parseUpdateSettings(value: Record<string, unknown>): UpdateUserSettingsPayload {
  if (
    !exact(value, ["expectedVersion", "group", "changes"], [
      "expectedVersion",
      "group",
      "changes",
    ]) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1 ||
    !isRecord(value.changes) ||
    Object.keys(value.changes).length === 0
  ) {
    throw new UserInitializationError("INVALID_ARGUMENT", "设置更新参数无效");
  }
  if (value.group === "ledger") {
    if (
      !exact(
        value.changes,
        [
          "defaultTransactionType",
          "defaultExpenseAccountId",
          "defaultIncomeAccountId",
        ],
        [],
      ) ||
      (value.changes.defaultTransactionType !== undefined &&
        value.changes.defaultTransactionType !== "expense" &&
        value.changes.defaultTransactionType !== "income") ||
      (value.changes.defaultExpenseAccountId !== undefined &&
        typeof value.changes.defaultExpenseAccountId !== "string") ||
      (value.changes.defaultIncomeAccountId !== undefined &&
        typeof value.changes.defaultIncomeAccountId !== "string")
    ) {
      throw new UserInitializationError(
        "INVALID_ARGUMENT",
        "记账设置更新参数无效",
      );
    }
    return {
      expectedVersion: value.expectedVersion,
      group: "ledger",
      changes: {
        ...(value.changes.defaultTransactionType === undefined
          ? {}
          : {
              defaultTransactionType:
                value.changes.defaultTransactionType,
            }),
        ...(value.changes.defaultExpenseAccountId === undefined
          ? {}
          : {
              defaultExpenseAccountId:
                value.changes.defaultExpenseAccountId,
            }),
        ...(value.changes.defaultIncomeAccountId === undefined
          ? {}
          : {
              defaultIncomeAccountId:
                value.changes.defaultIncomeAccountId,
            }),
      },
    };
  }
  if (
    value.group !== "weather" ||
    !exact(value.changes, ["defaultLocation", "preferGeolocation"], []) ||
    (value.changes.preferGeolocation !== undefined &&
      typeof value.changes.preferGeolocation !== "boolean")
  ) {
    throw new UserInitializationError(
      "INVALID_ARGUMENT",
      "天气设置更新参数无效",
    );
  }
  return {
    expectedVersion: value.expectedVersion,
    group: "weather",
    changes: {
      ...(value.changes.defaultLocation === undefined
        ? {}
        : { defaultLocation: parseLocation(value.changes.defaultLocation) }),
      ...(value.changes.preferGeolocation === undefined
        ? {}
        : { preferGeolocation: value.changes.preferGeolocation }),
    },
  };
}

function success(data: UserResponseData, requestId: string, now: Date): ApiResponse<UserResponseData> {
  return { success: true, code: "OK", message: "操作成功", data, requestId, serverTime: now.toISOString() };
}

function failure(code: ApiErrorCode, message: string, requestId: string, now: Date): ApiResponse<UserResponseData> {
  return { success: false, code, message, data: null, requestId, serverTime: now.toISOString() };
}

export function createUserFunctionHandler(dependencies: UserFunctionDependencies): (event: unknown) => Promise<ApiResponse<UserResponseData>> {
  return async (event) => {
    const now = dependencies.getCurrentTime();
    const fallbackRequestId = extractRequestId(event);
    try {
      if (!isRecord(event) || typeof event.action !== "string" || !isRecord(event.payload) || typeof event.requestId !== "string" || !UUID_PATTERN.test(event.requestId)) {
        throw new UserInitializationError("INVALID_ARGUMENT", "请求格式无效");
      }
      if (["ownerId", "userId", "openId", "openid", "OPENID"].some((key) => Object.prototype.hasOwnProperty.call(event, key))) {
        throw new UserInitializationError("INVALID_ARGUMENT", "请求包含不可信身份字段");
      }
      const openId = dependencies.getOpenId();
      let data: UserResponseData;
      if (event.action === "init") {
        if (Object.keys(event.payload).length !== 0) throw new UserInitializationError("INVALID_ARGUMENT", "用户初始化不接受业务参数");
        if (!openId?.trim()) throw new UserInitializationError("UNAUTHENTICATED", "无法获取有效的微信用户身份");
        data = await initializeUser({ openId, now, store: dependencies.store });
      } else if (event.action === "getSettings") {
        if (Object.keys(event.payload).length !== 0) throw new UserInitializationError("INVALID_ARGUMENT", "设置查询不接受业务参数");
        data = await getUserSettings({ openId, store: dependencies.store });
      } else if (event.action === "updateSettings") {
        data = await updateUserSettings({ openId, payload: parseUpdateSettings(event.payload), now, store: dependencies.store });
      } else {
        throw new UserInitializationError("INVALID_ARGUMENT", "未知的用户操作");
      }
      return success(data, event.requestId, now);
    } catch (error) {
      if (error instanceof UserInitializationError) return failure(error.code, error.message, fallbackRequestId, now);
      return failure("DEPENDENCY_ERROR", "用户服务暂时不可用，请稍后重试", fallbackRequestId, now);
    }
  };
}

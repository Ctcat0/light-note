import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type {
  DefaultLocation,
  Theme,
  User,
  UserInitializationResult,
  UserInitializationStatus,
  UserInitPayload,
  UserSettings,
  UpdateUserSettingsPayload,
} from "../types/user";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import {
  callCloudFunctionWithMetadata,
  type CloudCallOptions,
  type CloudCallResult,
} from "./cloud";

export type UserInitializationCallResult =
  CloudCallResult<UserInitializationResult>;

export type UserInitializationTransport = (
  options: CloudCallOptions<UserInitPayload, UserInitializationResult>,
) => Promise<UserInitializationCallResult>;

function parseUser(value: unknown): User {
  if (
    !isRecord(value) ||
    typeof value.userId !== "string" ||
    (value.nickname !== null && typeof value.nickname !== "string") ||
    (value.avatarUrl !== null && typeof value.avatarUrl !== "string") ||
    value.status !== "active"
  ) {
    throw new Error("用户初始化响应中的用户信息无效");
  }

  return {
    userId: value.userId,
    nickname: value.nickname,
    avatarUrl: value.avatarUrl,
    status: value.status,
  };
}

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function parseDefaultLocation(value: unknown): DefaultLocation | null {
  if (value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    typeof value.locationKey !== "string" ||
    typeof value.displayName !== "string" ||
    (value.source !== "manual" && value.source !== "geolocation")
  ) {
    throw new Error("用户初始化响应中的默认位置无效");
  }

  return {
    locationKey: value.locationKey,
    displayName: value.displayName,
    source: value.source,
  };
}

export function parseSettings(value: unknown): UserSettings {
  if (
    !isRecord(value) ||
    value.currency !== "CNY" ||
    typeof value.timezone !== "string" ||
    (value.defaultTransactionType !== "expense" &&
      value.defaultTransactionType !== "income") ||
    typeof value.defaultExpenseAccountId !== "string" ||
    typeof value.defaultIncomeAccountId !== "string" ||
    typeof value.preferGeolocation !== "boolean" ||
    typeof value.showWeather !== "boolean" ||
    typeof value.showBudget !== "boolean" ||
    !isTheme(value.theme) ||
    !Number.isSafeInteger(value.version) ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("用户初始化响应中的设置无效");
  }

  return {
    currency: value.currency,
    timezone: value.timezone,
    defaultTransactionType: value.defaultTransactionType,
    defaultExpenseAccountId: value.defaultExpenseAccountId,
    defaultIncomeAccountId: value.defaultIncomeAccountId,
    defaultLocation: parseDefaultLocation(value.defaultLocation),
    preferGeolocation: value.preferGeolocation,
    showWeather: value.showWeather,
    showBudget: value.showBudget,
    theme: value.theme,
    version: value.version as number,
    updatedAt: value.updatedAt,
  };
}

function parseInitializationStatus(value: unknown): UserInitializationStatus {
  if (
    !isRecord(value) ||
    typeof value.userCreated !== "boolean" ||
    !Number.isSafeInteger(value.expenseCategoriesCreated) ||
    !Number.isSafeInteger(value.incomeCategoriesCreated) ||
    !Number.isSafeInteger(value.accountsCreated) ||
    typeof value.repeatedInitialization !== "boolean" ||
    typeof value.completed !== "boolean"
  ) {
    throw new Error("用户初始化响应中的初始化状态无效");
  }

  return {
    userCreated: value.userCreated,
    expenseCategoriesCreated: value.expenseCategoriesCreated as number,
    incomeCategoriesCreated: value.incomeCategoriesCreated as number,
    accountsCreated: value.accountsCreated as number,
    repeatedInitialization: value.repeatedInitialization,
    completed: value.completed,
  };
}

function parseInitializationResult(value: unknown): UserInitializationResult {
  if (!isRecord(value) || typeof value.isNewUser !== "boolean") {
    throw new Error("用户初始化响应无效");
  }

  return {
    isNewUser: value.isNewUser,
    user: parseUser(value.user),
    settings: parseSettings(value.settings),
    initialization: parseInitializationStatus(value.initialization),
  };
}

export function createUserInitializationService(
  transport: UserInitializationTransport = callCloudFunctionWithMetadata,
): { initialize(): Promise<UserInitializationCallResult> } {
  let initializationRequest: Promise<UserInitializationCallResult> | null = null;

  function clearRequest(
    request: Promise<UserInitializationCallResult>,
  ): void {
    if (initializationRequest === request) {
      initializationRequest = null;
    }
  }

  return {
    initialize(): Promise<UserInitializationCallResult> {
      if (initializationRequest !== null) {
        return initializationRequest;
      }

      const request = transport({
        functionName: CLOUD_FUNCTIONS.USER,
        action: "init",
        requestId: createRequestId(),
        payload: {},
        parseData: parseInitializationResult,
        timeoutMs: 15_000,
      });

      initializationRequest = request;
      void request.then(
        () => clearRequest(request),
        () => clearRequest(request),
      );

      return request;
    },
  };
}

export { parseInitializationResult };

const userInitializationService = createUserInitializationService();

export function initializeCurrentUser(): Promise<UserInitializationCallResult> {
  return userInitializationService.initialize();
}

export function getCurrentUserSettings(): Promise<UserSettings> {
  return callCloudFunctionWithMetadata({
    functionName: CLOUD_FUNCTIONS.USER,
    action: "getSettings",
    requestId: createRequestId(),
    payload: {},
    parseData: parseSettings,
  }).then((result) => result.data);
}

export function updateCurrentUserSettings(
  payload: UpdateUserSettingsPayload,
): Promise<UserSettings> {
  return callCloudFunctionWithMetadata({
    functionName: CLOUD_FUNCTIONS.USER,
    action: "updateSettings",
    requestId: createRequestId(),
    payload,
    parseData: parseSettings,
  }).then((result) => result.data);
}

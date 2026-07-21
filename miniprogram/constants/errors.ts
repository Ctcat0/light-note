import type { ApiErrorCode } from "../types/api";
import type { ClientErrorCode } from "../types/error";

export const API_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "UNAUTHENTICATED",
  "USER_DISABLED",
  "RESOURCE_NOT_FOUND",
  "VERSION_CONFLICT",
  "DUPLICATE_REQUEST",
  "RATE_LIMITED",
  "WEATHER_LOCATION_REQUIRED",
  "WEATHER_UNAVAILABLE",
  "DEPENDENCY_ERROR",
  "INTERNAL_ERROR",
] as const satisfies readonly ApiErrorCode[];

export const CLIENT_ERROR_CODES = {
  CLOUD_NOT_CONFIGURED: "CLOUD_NOT_CONFIGURED",
  CLOUD_UNAVAILABLE: "CLOUD_UNAVAILABLE",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const satisfies Record<ClientErrorCode, ClientErrorCode>;

export const DEFAULT_ERROR_MESSAGE = "操作未完成，请稍后重试";


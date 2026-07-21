import type { ApiErrorCode } from "./api";

export type ClientErrorCode =
  | "CLOUD_NOT_CONFIGURED"
  | "CLOUD_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export type AppErrorCode = ApiErrorCode | ClientErrorCode;

export interface ErrorViewModel {
  message: string;
  requestId: string | null;
}


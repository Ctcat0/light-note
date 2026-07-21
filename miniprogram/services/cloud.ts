import { environment } from "../config/environment";
import {
  API_ERROR_CODES,
  CLIENT_ERROR_CODES,
} from "../constants/errors";
import type {
  ApiErrorCode,
  ApiResponse,
  CloudFunctionRequest,
} from "../types/api";
import { AppError, normalizeError } from "../utils/error";
import { isRecord } from "../utils/record";

export interface CloudInitializationResult {
  ready: boolean;
  errorMessage: string | null;
}

export interface CloudCallOptions<TPayload extends object, TData> {
  functionName: string;
  action: string;
  requestId: string;
  payload: TPayload;
  parseData: (value: unknown) => TData;
}

let isCloudInitialized = false;

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    API_ERROR_CODES.some((code) => code === value)
  );
}

function parseApiResponse(value: unknown): ApiResponse<unknown> {
  if (
    !isRecord(value) ||
    typeof value.success !== "boolean" ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.requestId !== "string" ||
    typeof value.serverTime !== "string"
  ) {
    throw new AppError(
      CLIENT_ERROR_CODES.INVALID_RESPONSE,
      "云函数返回格式无效",
    );
  }

  if (value.success) {
    if (value.code !== "OK" || !("data" in value)) {
      throw new AppError(
        CLIENT_ERROR_CODES.INVALID_RESPONSE,
        "云函数成功响应格式无效",
        value.requestId,
      );
    }

    return {
      success: true,
      code: "OK",
      message: value.message,
      data: value.data,
      requestId: value.requestId,
      serverTime: value.serverTime,
    };
  }

  if (!isApiErrorCode(value.code) || value.data !== null) {
    throw new AppError(
      CLIENT_ERROR_CODES.INVALID_RESPONSE,
      "云函数失败响应格式无效",
      value.requestId,
    );
  }

  return {
    success: false,
    code: value.code,
    message: value.message,
    data: null,
    requestId: value.requestId,
    serverTime: value.serverTime,
  };
}

export function initializeCloud(): CloudInitializationResult {
  if (!environment.enableCloud || environment.cloudEnvId.trim().length === 0) {
    return {
      ready: false,
      errorMessage: "CloudBase 开发环境尚未配置",
    };
  }

  try {
    wx.cloud.init({
      env: environment.cloudEnvId,
      traceUser: true,
    });
    isCloudInitialized = true;

    return { ready: true, errorMessage: null };
  } catch (error) {
    const normalized = normalizeError(
      error,
      CLIENT_ERROR_CODES.CLOUD_UNAVAILABLE,
      "CloudBase 初始化失败",
    );

    return { ready: false, errorMessage: normalized.message };
  }
}

function ensureCloudIsReady(): void {
  if (isCloudInitialized) {
    return;
  }

  const result = initializeCloud();

  if (!result.ready) {
    throw new AppError(
      CLIENT_ERROR_CODES.CLOUD_NOT_CONFIGURED,
      result.errorMessage ?? "CloudBase 尚未配置",
    );
  }
}

export async function callCloudFunction<TPayload extends object, TData>(
  options: CloudCallOptions<TPayload, TData>,
): Promise<TData> {
  ensureCloudIsReady();

  const request: CloudFunctionRequest<TPayload> = {
    action: options.action,
    requestId: options.requestId,
    payload: options.payload,
  };

  try {
    const response = await wx.cloud.callFunction({
      name: options.functionName,
      data: request,
    });
    const result = parseApiResponse(response.result);

    if (!result.success) {
      throw new AppError(result.code, result.message, result.requestId);
    }

    return options.parseData(result.data);
  } catch (error) {
    throw normalizeError(
      error,
      CLIENT_ERROR_CODES.NETWORK_ERROR,
      "云函数调用失败，请检查网络后重试",
    );
  }
}

import {
  getCurrentEnvironmentConfig,
  type EnvironmentConfig,
} from "../config/environment";
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

export interface CloudApi {
  init(config: { env: string; traceUser: boolean }): void;
  callFunction(options: {
    name: string;
    data: object;
  }): Promise<{ result?: unknown }>;
}

export interface CloudCallOptions<TPayload extends object, TData> {
  functionName: string;
  action: string;
  requestId: string;
  payload: TPayload;
  parseData: (value: unknown) => TData;
  timeoutMs?: number;
  cloudApi?: CloudApi;
}

export interface CloudCallResult<TData> {
  data: TData;
  requestId: string;
  serverTime: string;
}

let isCloudInitialized = false;

function callWithTimeout<TValue>(
  operation: Promise<TValue>,
  timeoutMs: number,
  requestId: string,
): Promise<TValue> {
  return new Promise<TValue>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          CLIENT_ERROR_CODES.NETWORK_ERROR,
          "云函数调用超时，请稍后重试",
          requestId,
        ),
      );
    }, timeoutMs);

    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    API_ERROR_CODES.some((code) => code === value)
  );
}

export function parseApiResponse(value: unknown): ApiResponse<unknown> {
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

export function initializeCloud(
  config: EnvironmentConfig = getCurrentEnvironmentConfig(),
  cloudApi: CloudApi = wx.cloud,
): CloudInitializationResult {
  if (!config.enableCloud || config.cloudEnvId.trim().length === 0) {
    return {
      ready: false,
      errorMessage: `CloudBase ${config.name} 环境尚未配置`,
    };
  }

  try {
    cloudApi.init({
      env: config.cloudEnvId,
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
  const result = await callCloudFunctionWithMetadata(options);

  return result.data;
}

export async function callCloudFunctionWithMetadata<
  TPayload extends object,
  TData,
>(
  options: CloudCallOptions<TPayload, TData>,
): Promise<CloudCallResult<TData>> {
  ensureCloudIsReady();

  const request: CloudFunctionRequest<TPayload> = {
    action: options.action,
    requestId: options.requestId,
    payload: options.payload,
  };

  try {
    const cloudApi = options.cloudApi ?? wx.cloud;
    const response = await callWithTimeout(
      cloudApi.callFunction({
        name: options.functionName,
        data: request,
      }),
      options.timeoutMs ?? 15_000,
      options.requestId,
    );
    const result = parseApiResponse(response.result);

    if (!result.success) {
      throw new AppError(result.code, result.message, result.requestId);
    }

    return {
      data: options.parseData(result.data),
      requestId: result.requestId,
      serverTime: result.serverTime,
    };
  } catch (error) {
    throw normalizeError(
      error,
      CLIENT_ERROR_CODES.NETWORK_ERROR,
      "云函数调用失败，请检查网络后重试",
    );
  }
}

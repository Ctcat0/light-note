import { CLOUD_FUNCTIONS } from "../constants/cloud";
import type {
  CancelDataDeletionResult,
  DataDeletionRequestSummary,
  GetDataDeletionStatusResult,
  RequestDataDeletionResult,
} from "../types/data-deletion";
import { createRequestId } from "../utils/request-id";
import { isRecord } from "../utils/record";
import {
  callCloudFunctionWithMetadata,
  type CloudCallOptions,
  type CloudCallResult,
} from "./cloud";

type Transport = <TPayload extends object, TData>(
  options: CloudCallOptions<TPayload, TData>,
) => Promise<CloudCallResult<TData>>;

function optionalDate(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      !Number.isNaN(new Date(value).getTime()))
  );
}

export function parseDeletionRequest(
  value: unknown,
): DataDeletionRequestSummary {
  if (
    !isRecord(value) ||
    !["pending", "cancelled", "processing", "completed", "failed"].includes(
      String(value.status),
    ) ||
    typeof value.requestedAt !== "string" ||
    Number.isNaN(new Date(value.requestedAt).getTime()) ||
    typeof value.cooldownEndsAt !== "string" ||
    Number.isNaN(new Date(value.cooldownEndsAt).getTime()) ||
    !optionalDate(value.cancelledAt) ||
    !optionalDate(value.processingStartedAt) ||
    !optionalDate(value.completedAt) ||
    !optionalDate(value.failedAt) ||
    typeof value.canCancel !== "boolean" ||
    !Number.isSafeInteger(value.version)
  ) {
    throw new Error("个人数据删除申请响应格式无效");
  }
  return value as unknown as DataDeletionRequestSummary;
}

function parseStatus(value: unknown): GetDataDeletionStatusResult {
  if (!isRecord(value) || !("request" in value)) {
    throw new Error("个人数据删除状态响应格式无效");
  }
  return {
    request:
      value.request === null ? null : parseDeletionRequest(value.request),
  };
}

function parseRequest(value: unknown): RequestDataDeletionResult {
  if (!isRecord(value) || typeof value.duplicate !== "boolean") {
    throw new Error("个人数据删除申请响应格式无效");
  }
  return {
    request: parseDeletionRequest(value.request),
    duplicate: value.duplicate,
  };
}

function parseCancel(value: unknown): CancelDataDeletionResult {
  if (!isRecord(value)) {
    throw new Error("撤销个人数据删除申请响应格式无效");
  }
  return { request: parseDeletionRequest(value.request) };
}

export function createDataDeletionService(
  transport: Transport = callCloudFunctionWithMetadata,
) {
  return {
    async getStatus(): Promise<GetDataDeletionStatusResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.DATA_DELETION,
        action: "getStatus",
        requestId: createRequestId(),
        payload: {},
        parseData: parseStatus,
      });
      return result.data;
    },
    async request(requestId: string): Promise<RequestDataDeletionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.DATA_DELETION,
        action: "request",
        requestId,
        payload: {},
        parseData: parseRequest,
      });
      return result.data;
    },
    async cancel(expectedVersion: number): Promise<CancelDataDeletionResult> {
      const result = await transport({
        functionName: CLOUD_FUNCTIONS.DATA_DELETION,
        action: "cancel",
        requestId: createRequestId(),
        payload: { expectedVersion },
        parseData: parseCancel,
      });
      return result.data;
    },
  };
}

export const dataDeletionService = createDataDeletionService();
